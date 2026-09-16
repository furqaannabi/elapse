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
  last_max_duration_seconds?: number | null;
  restarted_as?: string | null;
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
  /** FR-API-137. */
  start_mode?: "checkout" | "merchant";
  start_by?: number | null;
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
    // BR-CHK-003: once stopped, the chain's totals travel with the subscription so a receipt rebuilt
    // later shows the seconds billed, not started→canceled wall clock (which counts paused time).
    ...(w.status === "canceled" ? { settled: { secondsElapsed: w.seconds_elapsed, settledUsd: w.settled_usd } } : {}),
    // FR-CHK-034: held money is the real deposit (funded_usd), never the cap the page reads as fundedUsd.
    ...(w.status === "incomplete" && w.start_mode === "merchant" && typeof w.start_by === "number" && parseUsd(w.funded_usd) > 0n
      ? { hold: { startBy: w.start_by * 1000, heldUsd: w.funded_usd } }
      : {}),
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
    ...(w.last_max_duration_seconds ? { lastMaxDurationSeconds: w.last_max_duration_seconds } : {}),
    ...(w.restarted_as ? { restartedAs: w.restarted_as as `cs_${string}` } : {}),
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
  /**
   * A fresh Privy identity token (FR-CHK-027): sent as `X-Privy-Token` on the two binding
   * calls, prepare and cancel/prepare. `null` when nobody is signed in.
   */
  identityToken?: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  /** How long start/cancel wait for the chain before giving up. */
  confirmTimeoutMs?: number;
}

/** The API refused the identity token; worth one silent refresh before asking the subscriber to sign in. */
class StaleIdentity extends CheckoutApiError {
  constructor() {
    super("sign_in_required", "Sign in again.");
  }
}


export function createRealCheckoutApi(o: RealApiOptions): CheckoutApi {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeout = o.confirmTimeoutMs ?? 90_000;
  const local = { signedIn: false, email: undefined as string | undefined };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(o.headers?.() ?? {}), ...extra },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CheckoutApiError("network", "We couldn't reach Elapse. Check your connection and try again.");
    }
    const json = (await res.json().catch(() => null)) as { error?: { type?: string; code?: string; message?: string } } | null;
    if (!res.ok) {
      const serverCode = json?.error?.code;
      if (res.status === 503 && serverCode === "subscriber_auth_unconfigured") throw new CheckoutApiError("unconfigured", "Checkout is not set up yet.");
      if (res.status === 401 && serverCode === "subscriber_auth_invalid") throw new StaleIdentity();
      if (res.status === 403 && serverCode === "subscriber_mismatch") throw new CheckoutApiError("sign_in_required", "Sign in again.");
      if (res.status === 429 && serverCode === "receipt_already_sent") throw new CheckoutApiError("already_sent", "Already sent. Check your inbox.");
      if (res.status === 429) throw new CheckoutApiError("rate_limited", json?.error?.message ?? "Too many changes. Try again in a bit.");
      if (res.status === 400 && serverCode === "insufficient_balance") throw new CheckoutApiError("insufficient_funds", json?.error?.message ?? "Add funds to start.");
      const code = res.status === 404 ? "not_found" : res.status === 400 && serverCode === "invalid_cap" ? "invalid_amount" : res.status >= 500 ? "network" : "invalid_state";
      throw new CheckoutApiError(code, json?.error?.message ?? "Something went wrong.");
    }
    return json as T;
  }

  /**
   * FR-CHK-027: a binding call carries a fresh identity token. On the first 401 the token is
   * fetched again and the call retried once, silently; a second 401 (or a 403 mismatch)
   * surfaces as `sign_in_required`, which the page answers with the sign-in sheet.
   */
  async function bindingCall<T>(path: string, body: unknown, method: "GET" | "POST" = "POST"): Promise<T> {
    const attempt = async () => {
      const token = (await o.identityToken?.()) ?? null;
      if (!token) throw new CheckoutApiError("sign_in_required", "Sign in again.");
      return call<T>(method, path, body, { "X-Privy-Token": token });
    };
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof StaleIdentity) return attempt();
      throw e;
    }
  }

  const getWire = (id: string) => call<WireSession>("GET", `/v1/checkout/sessions/${id}`);
  const session = async (id: string) => mapSession(await getWire(id), local);
  const wallet = () => {
    const w = o.wallet();
    if (!w) throw new CheckoutApiError("invalid_state", "Sign in first.");
    return w;
  };

  /** Poll until `done(sub)`; returns the last wire session. */
  /** Prepare → sign (EIP-191 over the 32 bytes) → submit, for cancel, pause and resume (FR-CON-017/018). */
  async function relay(id: string, action: "cancel" | "pause" | "resume"): Promise<void> {
    const w = wallet();
    const auth = await bindingCall<{ message: `0x${string}`; deadline: string }>(`/v1/checkout/sessions/${id}/${action}/prepare`, {});
    const signature = await w.signMessage(auth.message);
    await call("POST", `/v1/checkout/sessions/${id}/${action}`, { signature, deadline: auth.deadline });
  }

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
      wallet(); // signed in, or "Sign in first." before any call goes out
      await bindingCall(`/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: seconds });
      return session(id);
    },

    async start(id) {
      const w = wallet();
      const wire = await getWire(id);
      const cap = wire.subscription?.max_duration_seconds ?? wire.max_duration_seconds;
      if (!cap) throw new CheckoutApiError("invalid_state", "Choose how long first.");
      // Re-prepare right before signing so the permit nonce and deadline are fresh.
      const prep = await bindingCall<{ permit: PermitPayload }>(`/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: cap });
      const signature = await w.signTypedData(prep.permit);
      await call("POST", `/v1/checkout/sessions/${id}/start`, { signature });
      return mapSession(await waitFor(id, (s) => s.subscription?.status === "active" || s.subscription?.status === "canceled"), local);
    },

    // FR-CHK-031: read before the cap step; polled while Add funds is open.
    async getBalance(id) {
      const w = await bindingCall<{ balance_usd: string; needs_funding: boolean; receive_address: string; token: string; network: string }>(`/v1/checkout/sessions/${id}/balance`, undefined, "GET");
      return { balanceUsd: w.balance_usd, needsFunding: w.needs_funding, receiveAddress: w.receive_address, token: w.token, network: w.network };
    },

    // FR-CHK-030: pause and resume are relayed like cancel (contracts FR-CON-018); no money moves.
    async pause(id) {
      await relay(id, "pause");
      return mapSession(await waitFor(id, (s) => s.subscription?.status === "paused" || s.subscription?.status === "canceled"), local);
    },
    async resume(id) {
      await relay(id, "resume");
      return mapSession(await waitFor(id, (s) => s.subscription?.status === "active" || s.subscription?.status === "canceled"), local);
    },

    async cancel(id) {
      await relay(id, "cancel");
      const done = await waitFor(id, (s) => s.subscription?.status === "canceled");
      return { session: mapSession(done, local), receipt: receiptFrom(done.subscription!) };
    },

    async getReceipt(id) {
      const w = await getWire(id);
      if (!w.subscription || w.subscription.status !== "canceled") throw new CheckoutApiError("invalid_state", "This meter has not stopped.");
      return receiptFrom(w.subscription);
    },

    // FR-CHK-007 / FR-API-126: a copy of this ended session, opened on the merchant's behalf for its own subscriber.
    async startAgain(id) {
      const next = await bindingCall<{ id: string; url: string }>(`/v1/checkout/sessions/${id}/again`, {});
      return session(next.id);
    },
    // FR-CHK-029: the receipt goes to the identity's email through the account route; the token proves who asks.
    async emailReceipt(id) {
      const w = await getWire(id);
      if (!w.subscription || w.subscription.status !== "canceled") throw new CheckoutApiError("invalid_state", "This meter has not stopped.");
      return bindingCall<{ sent: true }>(`/v1/account/subscriptions/${w.subscription.id}/receipt/email`, {});
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
