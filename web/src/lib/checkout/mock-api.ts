/**
 * In-memory checkout API. Stands in for `api/` until it exists; the page
 * talks to this through the same `CheckoutApi` interface it will use for
 * the real service, so swapping is a one-line change.
 *
 * Seeds one session per screen (FR-CHK-015) so any state is reachable by
 * URL: /c/cs_demo, /c/cs_ready, /c/cs_running, /c/cs_lowbal, /c/cs_capped,
 * /c/cs_paused, /c/cs_done, /c/cs_expired, /c/cs_used, /c/cs_archived.
 *
 * Money rules mirror the contract: the cap is the pot, reaching it ends
 * the session at that second (FR-CHK-007, contracts FR-CON-041), and any
 * stop settles whole seconds × rate and returns the rest (BR-CHK-002,
 * BR-CHK-003). Nothing here knows a secret key.
 */
import {
  formatUsd,
  parseRate,
  settledNano,
  wholeSeconds,
  elapsedMs as elapsedMsOf,
} from "@/lib/meter/math";
import { capEndsAt, formatReceiptUsd, maxEscrowNano, parseUsd, refundNano } from "./funding";
import type { CheckoutSession, Customer, EndedReason, Subscription } from "./types";

export type Receipt = {
  secondsElapsed: number;
  amountSettledUsd: string;
  refundedUsd: string;
  startedAt: number;
  canceledAt: number;
  rateUsdPerSecond: string;
  endedReason: EndedReason;
};

/**
 * Builds the receipt for a subscription that has stopped. Pure, so the
 * page can render a receipt for a session it opened after the fact and
 * get the same numbers the API reported (BR-CHK-003).
 */
export function buildReceipt(sub: Subscription): Receipt {
  const startedAt = sub.startedAt ?? 0;
  const canceledAt = sub.canceledAt ?? startedAt;
  const seconds = wholeSeconds(
    elapsedMsOf({ startedAt, now: canceledAt, pausedAt: sub.pausedAt }),
  );
  const rate = parseRate(sub.rateUsdPerSecond);
  const cap = parseUsd(sub.fundedUsd);
  let settled = settledNano(rate, seconds);
  if (settled > cap) settled = cap; // BR-CHK-002
  return {
    secondsElapsed: seconds,
    amountSettledUsd: formatReceiptUsd(settled),
    refundedUsd: formatReceiptUsd(refundNano(cap, settled)),
    startedAt,
    canceledAt,
    rateUsdPerSecond: sub.rateUsdPerSecond,
    endedReason: sub.endedReason ?? "canceled",
  };
}

export type Delivery = {
  id: string;
  type: string;
  status: number | null;
  attempt: number;
  at: number;
};

export type JudgeData = {
  chainId: number;
  chainName: string;
  contractAddress: string;
  streamAddress: string | null;
  blockTimeMs: number;
  indexerLagBlocks: number;
  deliveries: Delivery[];
};

export class CheckoutApiError extends Error {
  constructor(
    public code: "not_found" | "invalid_state" | "invalid_amount" | "network",
    message: string,
  ) {
    super(message);
  }
}

export interface CheckoutApi {
  getSession(id: string): Promise<CheckoutSession>;
  signIn(id: string, input: { email?: string }): Promise<CheckoutSession>;
  /** Authorise a cap in seconds. Escrow is rate × cap; it replaces any earlier choice. */
  setCap(id: string, seconds: number): Promise<CheckoutSession>;
  start(id: string): Promise<CheckoutSession>;
  pause(id: string): Promise<CheckoutSession>;
  resume(id: string): Promise<CheckoutSession>;
  cancel(id: string): Promise<{ session: CheckoutSession; receipt: Receipt }>;
  /** The receipt for a stopped session, however it stopped. */
  getReceipt(id: string): Promise<Receipt>;
  /** A fresh session for the same product, after one ended at its cap. */
  startAgain(id: string): Promise<CheckoutSession>;
  emailReceipt(id: string, email: string): Promise<{ sent: true }>;
  getJudgeData(id: string): Promise<JudgeData>;
}

export const SEEDED_SESSION_IDS = [
  "cs_demo",
  "cs_ready",
  "cs_running",
  "cs_lowbal",
  "cs_capped",
  "cs_paused",
  "cs_done",
  "cs_expired",
  "cs_used",
  "cs_archived",
] as const;

const MERCHANT = {
  name: "Nimbus",
  logoUrl: undefined,
  accent: undefined,
  supportUrl: "https://nimbus.example/support",
  successUrl: "https://nimbus.example/ok",
  cancelUrl: "https://nimbus.example/cancel",
};

const PRODUCT = {
  id: "prod_gpu4090" as const,
  name: "GPU · 4090",
  rateUsdPerSecond: "0.004",
  allowPause: false,
  status: "active" as const,
};

const CUSTOMER: Customer = { id: "cus_7Qw2m", email: "ada@example.com" };

const STREAM = "0x6f1a4b9c2d3e4f5061728394a5b6c7d8e9f0a1b2";
const FACTORY = "0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807";

function sub(over: Partial<Subscription>): Subscription {
  return {
    id: "sub_1S2xq6Hf9",
    status: "incomplete",
    startedAt: null,
    pausedAt: null,
    canceledAt: null,
    maxDurationSeconds: 0,
    fundedUsd: "0",
    rateUsdPerSecond: PRODUCT.rateUsdPerSecond,
    ...over,
  };
}

function seed(now: number): Record<string, CheckoutSession> {
  const open = (id: string, over: Partial<CheckoutSession> = {}): CheckoutSession => ({
    id: id as `cs_${string}`,
    status: "open",
    merchant: { ...MERCHANT },
    product: { ...PRODUCT },
    customer: null,
    subscription: null,
    expiresAt: now + 24 * 3_600_000,
    ...over,
  });
  // A one-hour cap at $0.004/s is $14.40 of escrow.
  const CAP = { maxDurationSeconds: 3600, fundedUsd: "14.4" };
  return {
    cs_demo: open("cs_demo"),
    cs_ready: open("cs_ready", { customer: CUSTOMER, subscription: sub({ ...CAP }) }),
    cs_running: open("cs_running", {
      customer: CUSTOMER,
      subscription: sub({ ...CAP, status: "active", startedAt: now - 83_000 }),
    }),
    cs_lowbal: open("cs_lowbal", {
      customer: CUSTOMER,
      subscription: sub({ ...CAP, status: "active", startedAt: now - 3_400_000 }),
    }),
    // Started long enough ago to have used its whole cap; the first read
    // finalises it (FR-CHK-007).
    cs_capped: open("cs_capped", {
      customer: CUSTOMER,
      subscription: sub({ ...CAP, status: "active", startedAt: now - 3_700_000 }),
    }),
    cs_paused: open("cs_paused", {
      product: { ...PRODUCT, allowPause: true },
      customer: CUSTOMER,
      subscription: sub({
        ...CAP,
        status: "paused",
        startedAt: now - 300_000,
        pausedAt: now - 60_000,
        pauseReason: "user",
      }),
    }),
    cs_done: open("cs_done", {
      status: "complete",
      customer: CUSTOMER,
      subscription: sub({
        ...CAP,
        status: "canceled",
        endedReason: "canceled",
        startedAt: now - 90_000,
        pausedAt: now - 6_600,
        canceledAt: now - 6_600,
      }),
    }),
    cs_expired: open("cs_expired", { status: "expired", expiresAt: now - 1 }),
    cs_used: open("cs_used", { status: "complete", customer: CUSTOMER }),
    cs_archived: open("cs_archived", { product: { ...PRODUCT, status: "archived" } }),
  };
}

export function createMockCheckoutApi(
  opts: { now?: () => number; latencyMs?: number } = {},
): CheckoutApi {
  const now = opts.now ?? (() => Date.now());
  const latency = opts.latencyMs ?? 350;
  const store = seed(now());
  const deliveries = new Map<string, Delivery[]>();
  let evt = 0;

  const wait = () =>
    latency > 0 ? new Promise<void>((r) => setTimeout(r, latency)) : Promise.resolve();

  /**
   * The contract ends a stream the first time anyone observes it past its
   * cap, back-dated to that second (contracts FR-CON-041). Every read and
   * every write goes through here, so the mock can never show a meter that
   * has run past what the subscriber authorised.
   */
  const finalizeIfCapped = (s: CheckoutSession): CheckoutSession => {
    const sb = s.subscription;
    if (!sb || sb.status !== "active" || sb.startedAt === null) return s;
    const endsAt = capEndsAt(sb.startedAt, parseUsd(sb.fundedUsd), parseRate(sb.rateUsdPerSecond));
    if (endsAt === null || now() < endsAt) return s;
    const ended: CheckoutSession = {
      ...s,
      status: "complete",
      subscription: {
        ...sb,
        status: "canceled",
        endedReason: "cap_reached",
        pausedAt: endsAt,
        canceledAt: endsAt,
      },
    };
    store[s.id] = ended;
    record(s.id, "invoice.payment_failed");
    record(s.id, "subscription.canceled");
    return ended;
  };

  const get = (id: string): CheckoutSession => {
    const s = store[id];
    if (!s) throw new CheckoutApiError("not_found", `No checkout session ${id}`);
    return finalizeIfCapped(s);
  };
  const put = (s: CheckoutSession) => {
    store[s.id] = s;
    return structuredClone(s);
  };
  const record = (id: string, type: string) => {
    const list = deliveries.get(id) ?? [];
    evt += 1;
    list.unshift({ id: `evt_${(1_000 + evt).toString(36)}`, type, status: 200, attempt: 1, at: now() });
    deliveries.set(id, list.slice(0, 8));
  };

  return {
    async getSession(id) {
      await wait();
      return structuredClone(get(id));
    },

    async signIn(id, input) {
      await wait();
      const s = get(id);
      if (s.status !== "open") throw new CheckoutApiError("invalid_state", "Session is not open");
      return put({
        ...s,
        customer: { id: `cus_${Math.random().toString(36).slice(2, 7)}`, email: input.email },
      });
    },

    async setCap(id, seconds) {
      await wait();
      const s = get(id);
      if (!s.customer) throw new CheckoutApiError("invalid_state", "Sign in first");
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new CheckoutApiError("invalid_amount", "Choose how long the meter may run");
      }
      const existing = s.subscription ?? sub({});
      if (existing.status !== "incomplete") {
        // The cap is signed for once and cannot be raised mid-session.
        throw new CheckoutApiError("invalid_state", "The meter is already running");
      }
      const capSeconds = Math.floor(seconds);
      const escrow = maxEscrowNano(capSeconds, parseRate(existing.rateUsdPerSecond));
      const fundedUsd = formatUsd(escrow, 3, { symbol: false }).replace(/\.?0+$/, "");
      return put({
        ...s,
        subscription: { ...existing, maxDurationSeconds: capSeconds, fundedUsd },
      });
    },

    async start(id) {
      await wait();
      const s = get(id);
      if (!s.subscription || parseUsd(s.subscription.fundedUsd) <= 0n) {
        throw new CheckoutApiError("invalid_state", "Choose how long the meter may run first");
      }
      if (s.subscription.status !== "incomplete") {
        throw new CheckoutApiError("invalid_state", "Already started");
      }
      const next = put({
        ...s,
        subscription: { ...s.subscription, status: "active", startedAt: now() },
      });
      record(id, "checkout.session.completed");
      record(id, "subscription.created");
      return next;
    },

    async pause(id) {
      await wait();
      const s = get(id);
      if (s.subscription?.status !== "active") {
        throw new CheckoutApiError("invalid_state", "Nothing to pause");
      }
      const next = put({
        ...s,
        subscription: { ...s.subscription, status: "paused", pausedAt: now(), pauseReason: "user" },
      });
      record(id, "subscription.updated");
      return next;
    },

    async resume(id) {
      await wait();
      const s = get(id);
      const sb = s.subscription;
      if (sb?.status !== "paused" || sb.startedAt === null || sb.pausedAt === null) {
        throw new CheckoutApiError("invalid_state", "Nothing to resume");
      }
      // Shift start forward by the paused span so elapsed excludes the pause.
      const shifted = sb.startedAt + (now() - sb.pausedAt);
      const next = put({
        ...s,
        subscription: {
          ...sb,
          status: "active",
          startedAt: shifted,
          pausedAt: null,
          pauseReason: undefined,
        },
      });
      record(id, "subscription.updated");
      return next;
    },

    async cancel(id) {
      await wait();
      const s = get(id);
      const sb = s.subscription;
      if (!sb || sb.status === "canceled" || sb.startedAt === null) {
        throw new CheckoutApiError("invalid_state", "Nothing to cancel");
      }
      const t = now();
      const stopped: Subscription = {
        ...sb,
        status: "canceled",
        endedReason: "canceled",
        pausedAt: sb.pausedAt ?? t,
        canceledAt: t,
      };
      const session = put({ ...s, status: "complete", subscription: stopped });
      record(id, "subscription.canceled");
      record(id, "invoice.settled");
      return { session, receipt: buildReceipt(stopped) };
    },

    async getReceipt(id) {
      await wait();
      const sb = get(id).subscription;
      if (!sb || sb.status !== "canceled") {
        throw new CheckoutApiError("invalid_state", "This session has not stopped");
      }
      return buildReceipt(sb);
    },

    async startAgain(id) {
      await wait();
      const s = get(id);
      const next: CheckoutSession = {
        ...s,
        id: `cs_${Math.random().toString(36).slice(2, 9)}`,
        status: "open",
        subscription: null,
        expiresAt: now() + 24 * 3_600_000,
      };
      return put(next);
    },

    async emailReceipt(id) {
      await wait();
      get(id);
      return { sent: true };
    },

    async getJudgeData(id) {
      await wait();
      const s = get(id);
      const list = deliveries.get(id) ?? [
        { id: "evt_seed2", type: "subscription.created", status: 200, attempt: 1, at: now() - 82_000 },
        { id: "evt_seed1", type: "checkout.session.completed", status: 200, attempt: 1, at: now() - 83_000 },
      ];
      return {
        chainId: 10143,
        chainName: "Monad Testnet",
        contractAddress: FACTORY,
        streamAddress: s.subscription ? STREAM : null,
        blockTimeMs: 400,
        indexerLagBlocks: 1,
        deliveries: list,
      };
    },
  };
}
