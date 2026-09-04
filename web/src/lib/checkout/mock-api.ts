/**
 * In-memory checkout API. Stands in for `api/` until it exists; the page
 * talks to this through the same `CheckoutApi` interface it will use for
 * the real service, so swapping is a one-line change.
 *
 * Seeds one session per screen (FR-CHK-015) so any state is reachable by
 * URL: /c/cs_demo, /c/cs_ready, /c/cs_running, /c/cs_lowbal, /c/cs_empty,
 * /c/cs_paused, /c/cs_done, /c/cs_expired, /c/cs_used, /c/cs_archived.
 *
 * Money rules mirror the contract: cancel settles whole seconds × rate and
 * refunds the rest (BR-CHK-002, BR-CHK-003). Nothing here knows a secret key.
 */
import {
  formatUsd,
  parseRate,
  settledNano,
  wholeSeconds,
  elapsedMs as elapsedMsOf,
} from "@/lib/meter/math";
import { formatReceiptUsd, parseUsd, refundNano } from "./funding";
import type { CheckoutSession, Customer, Subscription } from "./types";

export type Receipt = {
  secondsElapsed: number;
  amountSettledUsd: string;
  refundedUsd: string;
  startedAt: number;
  canceledAt: number;
  rateUsdPerSecond: string;
};

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
  fund(id: string, usd: string): Promise<CheckoutSession>;
  start(id: string): Promise<CheckoutSession>;
  pause(id: string): Promise<CheckoutSession>;
  resume(id: string): Promise<CheckoutSession>;
  cancel(id: string): Promise<{ session: CheckoutSession; receipt: Receipt }>;
  emailReceipt(id: string, email: string): Promise<{ sent: true }>;
  getJudgeData(id: string): Promise<JudgeData>;
}

export const SEEDED_SESSION_IDS = [
  "cs_demo",
  "cs_ready",
  "cs_running",
  "cs_lowbal",
  "cs_empty",
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
  // $10 at $0.004/s = 2500 s of runtime.
  return {
    cs_demo: open("cs_demo"),
    cs_ready: open("cs_ready", { customer: CUSTOMER, subscription: sub({ fundedUsd: "10" }) }),
    cs_running: open("cs_running", {
      customer: CUSTOMER,
      subscription: sub({ status: "active", fundedUsd: "10", startedAt: now - 83_000 }),
    }),
    cs_lowbal: open("cs_lowbal", {
      customer: CUSTOMER,
      subscription: sub({ status: "active", fundedUsd: "10", startedAt: now - 2_260_000 }),
    }),
    cs_empty: open("cs_empty", {
      customer: CUSTOMER,
      subscription: sub({
        status: "paused",
        fundedUsd: "10",
        startedAt: now - 2_600_000,
        pausedAt: now - 100_000,
        pauseReason: "out_of_funds",
      }),
    }),
    cs_paused: open("cs_paused", {
      product: { ...PRODUCT, allowPause: true },
      customer: CUSTOMER,
      subscription: sub({
        status: "paused",
        fundedUsd: "10",
        startedAt: now - 300_000,
        pausedAt: now - 60_000,
        pauseReason: "user",
      }),
    }),
    cs_done: open("cs_done", {
      status: "complete",
      customer: CUSTOMER,
      subscription: sub({
        status: "canceled",
        fundedUsd: "10",
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

  const get = (id: string): CheckoutSession => {
    const s = store[id];
    if (!s) throw new CheckoutApiError("not_found", `No checkout session ${id}`);
    return s;
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

    async fund(id, usd) {
      await wait();
      const s = get(id);
      if (!s.customer) throw new CheckoutApiError("invalid_state", "Sign in first");
      let add: bigint;
      try {
        add = parseUsd(usd);
      } catch {
        throw new CheckoutApiError("invalid_amount", "Enter a valid amount");
      }
      if (add <= 0n) throw new CheckoutApiError("invalid_amount", "Amount must be above zero");
      const existing = s.subscription ?? sub({});
      const funded = parseUsd(existing.fundedUsd) + add;
      const fundedUsd = formatUsd(funded, 3, { symbol: false }).replace(/\.?0+$/, "");
      // If we were paused for funds, top-up resumes the meter.
      const resumed =
        existing.status === "paused" && existing.pauseReason === "out_of_funds"
          ? { status: "active" as const, pausedAt: null, pauseReason: undefined }
          : {};
      const next = put({ ...s, subscription: { ...existing, fundedUsd, ...resumed } });
      if (resumed.status) record(id, "subscription.updated");
      return next;
    },

    async start(id) {
      await wait();
      const s = get(id);
      if (!s.subscription || parseUsd(s.subscription.fundedUsd) <= 0n) {
        throw new CheckoutApiError("invalid_state", "Add funds before starting");
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
      const elapsed = elapsedMsOf({ startedAt: sb.startedAt, now: t, pausedAt: sb.pausedAt });
      const seconds = wholeSeconds(elapsed);
      const rate = parseRate(sb.rateUsdPerSecond);
      const funded = parseUsd(sb.fundedUsd);
      let settled = settledNano(rate, seconds);
      if (settled > funded) settled = funded; // BR-CHK-002
      const refund = refundNano(funded, settled);
      const receipt: Receipt = {
        secondsElapsed: seconds,
        amountSettledUsd: formatReceiptUsd(settled),
        refundedUsd: formatReceiptUsd(refund),
        startedAt: sb.startedAt,
        canceledAt: t,
        rateUsdPerSecond: sb.rateUsdPerSecond,
      };
      const session = put({
        ...s,
        status: "complete",
        subscription: { ...sb, status: "canceled", pausedAt: sb.pausedAt ?? t, canceledAt: t },
      });
      record(id, "subscription.canceled");
      record(id, "invoice.settled");
      return { session, receipt };
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
