/**
 * The real `CheckoutApi` (FR-CHK-001…011 against API FR-API-031/032): the hosted page's
 * client for `/v1/checkout/sessions/:id` and its session-scoped actions. Snake_case wire
 * objects become the page's types here and nowhere else. The subscriber's wallet is behind
 * `SubscriberWallet` so the page never sees Privy; money moves only through a signature the
 * wallet produces for exactly the chosen cap (ADR 2026-09-04).
 *
 * Start and cancel return once the chain has confirmed: the API answers 202 with a pending
 * transaction and the client polls the session until the status flips (BR-API-005).
 */
import type { CheckoutApi, Receipt } from "./mock-api";
import { CheckoutApiError } from "./mock-api";
import type { CheckoutSession, Customer, Subscription } from "./types";
import { parseRate } from "@/lib/meter/math";
import { parseUsd } from "./funding";

export interface SubscriberWallet {
  /** Lowercase or checksummed 0x address; the API lowercases. */
  address: `0x${string}`;
  signTypedData(typedData: PermitPayload): Promise<`0x${string}`>;
  /** EIP-191 personal sign over 32 raw bytes (the cancel authorisation). */
  signMessage(rawHex: `0x${string}`): Promise<`0x${string}`>;
}

export type PermitPayload = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { Permit: Array<{ name: string; type: string }> };
  primaryType: "Permit";
  message: { owner: string; spender: string; value: string; nonce: string; deadline: string };
};

type WireSession = {
  id: string;
  status: "open" | "complete" | "expired";
  expires_at: number;
  merchant: { name: string; logo_url: string | null; accent: string | null; support_url: string | null; success_url: string; cancel_url: string };
  product: { id: string; name: string; rate_usd_per_second: string; allow_pause: boolean; active: boolean };
  customer: { id: string; email: string | null } | null;
  subscription: WireSubscription | null;
  max_duration_seconds: number | null;
  max_escrow_usd: string | null;
};
type WireSubscription = {
  id: string;
  status: Subscription["status"];
  started_at: number | null;
  paused_at: number | null;
  canceled_at: number | null;
  ended_reason: "canceled" | "cap_reached" | null;
  max_duration_seconds: number;
  max_escrow_usd: string;
  funded_usd: string;
  settled_usd: string;
  seconds_elapsed: number;
  rate_usd_per_second: string;
  stream_address: string | null;
};

const ms = (s: number | null) => (s === null ? null : s * 1000);

export function mapSubscription(w: WireSubscription): Subscription {
  return {
    id: w.id as Subscription["id"],
    status: w.status,
    startedAt: ms(w.started_at),
    pausedAt: ms(w.paused_at),
    canceledAt: ms(w.canceled_at),
    ...(w.ended_reason ? { endedReason: w.ended_reason } : {}),
    maxDurationSeconds: w.max_duration_seconds,
    // The pot: rate × cap. Before start nothing is deposited yet, but the page reads this as the cap.
    fundedUsd: w.max_escrow_usd,
    rateUsdPerSecond: w.rate_usd_per_second,
  };
}

export function mapSession(w: WireSession, local?: { signedIn: boolean }): CheckoutSession {
  const customer: Customer | null = w.customer ? { id: w.customer.id as Customer["id"], ...(w.customer.email ? { email: w.customer.email } : {}) } : null;
  return {
    id: w.id as CheckoutSession["id"],
    status: w.status,
    expiresAt: w.expires_at * 1000,
    merchant: {
      name: w.merchant.name,
      ...(w.merchant.logo_url ? { logoUrl: w.merchant.logo_url } : {}),
      ...(w.merchant.accent ? { accent: w.merchant.accent } : {}),
      ...(w.merchant.support_url ? { supportUrl: w.merchant.support_url } : {}),
      successUrl: w.merchant.success_url,
      cancelUrl: w.merchant.cancel_url,
    },
    product: {
      id: w.product.id as `prod_${string}`,
      name: w.product.name,
      rateUsdPerSecond: w.product.rate_usd_per_second,
      allowPause: w.product.allow_pause,
      status: w.product.active ? "active" : "archived",
    },
    customer,
    subscription: w.subscription ? mapSubscription(w.subscription) : null,
    ...(local?.signedIn && !customer ? { signedIn: true } : {}),
  };
}

/** Receipt from the server's own numbers (BR-CHK-003): settled and refunded come from the chain, not recomputed. */
export function receiptFrom(w: WireSubscription): Receipt {
  const settled = w.settled_usd;
  const pot = parseUsd(w.max_escrow_usd);
  const refunded = pot - parseUsd(settled);
  return {
    secondsElapsed: w.seconds_elapsed,
    amountSettledUsd: settled,
    refundedUsd: formatNano(refunded < 0n ? 0n : refunded),
    startedAt: (w.started_at ?? 0) * 1000,
    canceledAt: (w.canceled_at ?? w.started_at ?? 0) * 1000,
    rateUsdPerSecond: w.rate_usd_per_second,
    endedReason: w.ended_reason ?? "canceled",
  };
}

/** nano-USD (parseUsd's unit) → decimal string, trailing zeros trimmed. */
function formatNano(n: bigint): string {
  const s = n.toString().padStart(10, "0");
  const whole = s.slice(0, -9);
  const frac = s.slice(-9).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export interface RealApiOptions {
  baseUrl: string;
  /** Present once the subscriber has signed in; throws inside actions that need it otherwise. */
  wallet: () => SubscriberWallet | null;
  /** Extra headers for every call (the publishable key, once decided). */
  headers?: () => Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
  /** How long start/cancel wait for the chain before giving up. */
  confirmTimeoutMs?: number;
}

const NOT_AVAILABLE = (what: string) => new CheckoutApiError("invalid_state", `${what} is not available yet.`);

export function createRealCheckoutApi(o: RealApiOptions): CheckoutApi {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeout = o.confirmTimeoutMs ?? 90_000;
  const local = { signedIn: false, email: undefined as string | undefined };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(o.headers?.() ?? {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CheckoutApiError("network", "We couldn't reach Elapse. Check your connection and try again.");
    }
    const json = (await res.json().catch(() => null)) as { error?: { type?: string; code?: string; message?: string } } | null;
    if (!res.ok) {
      const code = res.status === 404 ? "not_found" : res.status === 400 && json?.error?.code === "invalid_cap" ? "invalid_amount" : res.status >= 500 ? "network" : "invalid_state";
      throw new CheckoutApiError(code, json?.error?.message ?? "Something went wrong.");
    }
    return json as T;
  }

  const getWire = (id: string) => call<WireSession>("GET", `/v1/checkout/sessions/${id}`);
  const session = async (id: string) => mapSession(await getWire(id), local);
  const wallet = () => {
    const w = o.wallet();
    if (!w) throw new CheckoutApiError("invalid_state", "Sign in first.");
    return w;
  };

  /** Poll until `done(sub)`; returns the last wire session. */
  async function waitFor(id: string, done: (w: WireSession) => boolean): Promise<WireSession> {
    const deadline = Date.now() + timeout;
    let w = await getWire(id);
    while (!done(w) && Date.now() < deadline) {
      await sleep(1500);
      w = await getWire(id);
    }
    if (!done(w)) throw new CheckoutApiError("network", "The network is taking longer than usual. Your meter state will update shortly.");
    return w;
  }

  return {
    getSession: session,

    async signIn(id, input) {
      // Privy has already run by the time the page calls this; the wallet is known.
      wallet();
      local.signedIn = true;
      local.email = input.email;
      return session(id);
    },

    async setCap(id, seconds) {
      const w = wallet();
      await call("POST", `/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: seconds, wallet_address: w.address, ...(local.email ? { email: local.email } : {}) });
      return session(id);
    },

    async start(id) {
      const w = wallet();
      const wire = await getWire(id);
      const cap = wire.subscription?.max_duration_seconds ?? wire.max_duration_seconds;
      if (!cap) throw new CheckoutApiError("invalid_state", "Choose how long first.");
      // Re-prepare right before signing so the permit nonce and deadline are fresh.
      const prep = await call<{ permit: PermitPayload }>("POST", `/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: cap, wallet_address: w.address, ...(local.email ? { email: local.email } : {}) });
      const signature = await w.signTypedData(prep.permit);
      await call("POST", `/v1/checkout/sessions/${id}/start`, { signature });
      return mapSession(await waitFor(id, (s) => s.subscription?.status === "active" || s.subscription?.status === "canceled"), local);
    },

    async pause() {
      throw NOT_AVAILABLE("Pause");
    },
    async resume() {
      throw NOT_AVAILABLE("Resume");
    },

    async cancel(id) {
      const w = wallet();
      const auth = await call<{ message: `0x${string}`; deadline: string }>("POST", `/v1/checkout/sessions/${id}/cancel/prepare`, {});
      const signature = await w.signMessage(auth.message);
      await call("POST", `/v1/checkout/sessions/${id}/cancel`, { signature, deadline: auth.deadline });
      const done = await waitFor(id, (s) => s.subscription?.status === "canceled");
      return { session: mapSession(done, local), receipt: receiptFrom(done.subscription!) };
    },

    async getReceipt(id) {
      const w = await getWire(id);
      if (!w.subscription || w.subscription.status !== "canceled") throw new CheckoutApiError("invalid_state", "This meter has not stopped.");
      return receiptFrom(w.subscription);
    },

    async startAgain() {
      throw NOT_AVAILABLE("Start again");
    },
    async emailReceipt() {
      throw NOT_AVAILABLE("Email receipt");
    },

    async getJudgeData(id) {
      const [status, w] = await Promise.all([
        call<{ chain_id: number; block_time_ms: number; contracts: { factory: string }; indexer: { ok: boolean; lag_blocks: number | null } }>("GET", "/v1/status"),
        getWire(id),
      ]);
      const deliveries = await call<{ data: Array<{ id: string; type: string; status: number | null; attempt: number; at: number }> }>("GET", `/v1/checkout/sessions/${id}/deliveries`).catch(() => ({ data: [] }));
      return {
        chainId: status.chain_id,
        chainName: status.chain_id === 143 ? "Monad" : "Monad Testnet",
        contractAddress: status.contracts.factory,
        streamAddress: w.subscription?.stream_address ?? null,
        blockTimeMs: status.block_time_ms,
        indexerLagBlocks: status.indexer.lag_blocks ?? 0,
        deliveries: deliveries.data.map((d) => ({ ...d, at: d.at * 1000 })),
      };
    },
  };
}

// parseRate is imported for the receipt's type parity with the mock; kept for future use.
void parseRate;
