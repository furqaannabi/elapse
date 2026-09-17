/**
 * The subscriber account against the platform API (FR-CHK-016–020, API FR-API-121/123; ADR
 * 2026-09-07 account on real data). Same `AccountApi` shape as the mock, so the page does not
 * know which it holds. Every call carries the Privy identity token; no token, or a refused
 * one, reads as signed out. Rows come back for both modes; a test-mode meter is tagged.
 * Cancel mirrors the checkout: prepare, sign the 32 bytes with the embedded wallet, submit,
 * then poll the list until ingest confirms `canceled`.
 */
import { AccountApiError, type AccountApi } from "./mock-api";
import type { AccountHeld, AccountMerchant, AccountMeter, AccountReceipt, AccountView } from "./types";
import type { SubscriberWallet } from "@/lib/checkout/real-api";

export interface WireAccountSubscription {
  id: `sub_${string}`;
  status: "active" | "paused" | "canceled" | "incomplete";
  livemode: boolean;
  checkout_session?: string | null;
  restarted_as?: string | null;
  merchant: { name: string; logo_url: string | null; support_url: string | null };
  product: { name: string; rate_usd_per_second: string; allow_pause?: boolean };
  started_at: number | null;
  paused_at: number | null;
  canceled_at: number | null;
  ended_reason: "canceled" | "cap_reached" | null;
  max_duration_seconds: number;
  funded_usd: string;
  settled_usd: string;
  refunded_usd: string;
  seconds_elapsed: number;
  /** FR-API-137/138. */
  start_mode?: "checkout" | "merchant";
  start_by?: number | null;
}

export interface RealAccountOptions {
  baseUrl: string;
  wallet: () => SubscriberWallet | null;
  identityToken: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  confirmTimeoutMs?: number;
}

const merchantOf = (w: WireAccountSubscription["merchant"]): AccountMerchant => ({
  name: w.name,
  ...(w.logo_url ? { logoUrl: w.logo_url } : {}),
  ...(w.support_url ? { supportUrl: w.support_url } : {}),
});
const ms = (s: number | null) => (s === null ? null : s * 1000);

export function meterFrom(w: WireAccountSubscription): AccountMeter {
  return {
    subscription: w.id,
    test: !w.livemode,
    merchant: merchantOf(w.merchant),
    product: { name: w.product.name, rateUsdPerSecond: w.product.rate_usd_per_second },
    status: w.status === "paused" ? "paused" : "active",
    ...(w.product.allow_pause ? { allowPause: true } : {}),
    startedAt: ms(w.started_at) ?? 0,
    pausedAt: ms(w.paused_at),
    maxDurationSeconds: w.max_duration_seconds,
    fundedUsd: w.funded_usd,
    // FR-CHK-037: listed as a meter means active or paused, so merchant mode here means the merchant started it.
    ...(w.start_mode === "merchant" ? { merchantControlled: true } : {}),
  };
}

/** FR-CHK-036: the API lists an `incomplete` row only when it is held money (FR-API-138). */
export function heldFrom(w: WireAccountSubscription): AccountHeld {
  return {
    subscription: w.id,
    test: !w.livemode,
    merchant: merchantOf(w.merchant),
    product: { name: w.product.name },
    heldUsd: w.funded_usd,
    startBy: (w.start_by ?? 0) * 1000,
  };
}

export function receiptFrom(w: WireAccountSubscription): AccountReceipt {
  return {
    subscription: w.id,
    ...(w.checkout_session ? { session: w.checkout_session as `cs_${string}` } : {}),
    ...(w.restarted_as ? { restartedAs: w.restarted_as as `cs_${string}` } : {}),
    test: !w.livemode,
    merchant: merchantOf(w.merchant),
    product: { name: w.product.name, rateUsdPerSecond: w.product.rate_usd_per_second },
    seconds: w.seconds_elapsed,
    amountSettledUsd: w.settled_usd,
    refundedUsd: w.refunded_usd,
    startedAt: ms(w.started_at) ?? 0,
    settledAt: ms(w.canceled_at) ?? ms(w.started_at) ?? 0,
    endedReason: w.ended_reason ?? "canceled",
    maxDurationSeconds: w.max_duration_seconds,
  };
}

export function viewFrom(rows: WireAccountSubscription[]): AccountView {
  const running = rows.filter((r) => r.status === "active" || r.status === "paused");
  const ended = rows.filter((r) => r.status === "canceled");
  const held = rows.filter((r) => r.status === "incomplete" && r.start_mode === "merchant" && typeof r.start_by === "number");
  return {
    status: "signed_in",
    held: held.map(heldFrom).sort((a, b) => a.startBy - b.startBy),
    meters: running.map(meterFrom).sort((a, b) => b.startedAt - a.startedAt),
    receipts: ended.map(receiptFrom).sort((a, b) => b.settledAt - a.settledAt),
  };
}

class SignedOut extends AccountApiError {
  constructor() {
    super("invalid_state", "Sign in to see your meters.");
  }
}

export function createRealAccountApi(o: RealAccountOptions): AccountApi {
  const sleep = o.sleep ?? ((t) => new Promise((r) => setTimeout(r, t)));
  const timeout = o.confirmTimeoutMs ?? 90_000;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await o.identityToken();
    if (!token) throw new SignedOut();
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}${path}`, {
        method,
        headers: { "X-Privy-Token": token, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AccountApiError("network", "We couldn't reach Elapse. Check your connection and try again.");
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      const code = json?.error?.code;
      if (res.status === 401) throw new SignedOut();
      if (res.status === 404) throw new AccountApiError("not_found", "That meter is not yours or no longer exists.");
      if (res.status === 429 && code === "receipt_already_sent") throw new AccountApiError("already_sent", "Already sent. Check your inbox.");
      if (res.status === 429) throw new AccountApiError("rate_limited", json?.error?.message ?? "Too many changes. Try again in a bit.");
      throw new AccountApiError(res.status >= 500 ? "network" : "invalid_state", json?.error?.message ?? "Something went wrong.");
    }
    return json as T;
  }

  /**
   * Prepare → sign (EIP-191 over the 32 bytes) → submit one relayed action (FR-CON-017/018),
   * then poll the list until the subscription's row satisfies `done`.
   */
  async function relay(subscription: string, action: "cancel" | "pause" | "resume", done: (r: WireAccountSubscription) => boolean) {
    const w = o.wallet();
    if (!w) throw new SignedOut();
    const auth = await call<{ message: `0x${string}`; deadline: string }>("POST", `/v1/account/subscriptions/${subscription}/${action}/prepare`, {});
    const signature = await w.signMessage(auth.message);
    await call("POST", `/v1/account/subscriptions/${subscription}/${action}`, { signature, deadline: auth.deadline });
    const deadline = Date.now() + timeout;
    let rows = await list();
    let row = rows.find((r) => r.id === subscription && done(r));
    while (!row && Date.now() < deadline) {
      await sleep(1500);
      rows = await list();
      row = rows.find((r) => r.id === subscription && done(r));
    }
    if (!row) throw new AccountApiError("network", "The network is taking longer than usual. Your meter will update shortly.");
    return { row, rows };
  }

  const list = async () => (await call<{ data: WireAccountSubscription[] }>("GET", "/v1/account/subscriptions")).data;

  async function view(): Promise<AccountView> {
    try {
      return viewFrom(await list());
    } catch (e) {
      if (e instanceof SignedOut) return { status: "signed_out" };
      throw e;
    }
  }

  return {
    getView: view,
    // Privy has already run by the time the page calls this; reading the list is the sign-in.
    signIn: view,

    async cancel(subscription) {
      const { row, rows } = await relay(subscription, "cancel", (r) => r.status === "canceled");
      return { receipt: receiptFrom(row), view: viewFrom(rows) };
    },

    // FR-CHK-030: the same prepare → sign → submit → poll as cancel; no money moves.
    async pause(subscription) {
      return viewFrom((await relay(subscription, "pause", (r) => r.status !== "active")).rows);
    },
    async resume(subscription) {
      return viewFrom((await relay(subscription, "resume", (r) => r.status !== "paused")).rows);
    },

    async emailReceipt(subscription) {
      return call<{ sent: true }>("POST", `/v1/account/subscriptions/${subscription}/receipt/email`, {});
    },

    // FR-API-126 through the checkout route: the identity token is the only pass it needs.
    async startAgain(session) {
      const next = await call<{ id: string; url: string }>("POST", `/v1/checkout/sessions/${session}/again`, {});
      return { url: next.url };
    },
  };
}
