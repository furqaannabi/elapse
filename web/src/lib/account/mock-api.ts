/**
 * In-memory subscriber account API. Stands in for `api/` until it exists;
 * `/account` talks to it through the `AccountApi` interface it will use
 * for the real service, so swapping is a one-line change.
 *
 * The identity is the subscriber's passkey wallet address. It lives only
 * here: nothing this module returns contains it (FR-CHK-022). Money rules
 * mirror the contract — the cap is the pot, reaching it ends the session
 * at that second, and any stop settles whole seconds × rate and returns
 * the rest (FR-CHK-007, BR-CHK-002, BR-CHK-003).
 *
 * Seeds one identity per screen (FR-CHK-025), chosen with `?as=`.
 */
import { capEndsAt, formatReceiptUsd, maxEscrowNano, parseUsd, refundNano } from "@/lib/checkout/funding";
import {
  elapsedMs as elapsedMsOf,
  formatUsd,
  parseRate,
  settledNano,
  wholeSeconds,
} from "@/lib/meter/math";
import type { AccountMeter, AccountReceipt, AccountView, AccountHeld } from "./types";

export const ACCOUNT_SEEDS = ["two-merchants", "empty", "low-balance", "signed-out", "held"] as const;
export type AccountSeed = (typeof ACCOUNT_SEEDS)[number];

export class AccountApiError extends Error {
  constructor(
    public code: "not_found" | "invalid_state" | "network" | "already_sent" | "rate_limited",
    message: string,
  ) {
    super(message);
  }
}

export interface AccountApi {
  /** Everything the page shows, with any capped meter already ended. */
  getView(): Promise<AccountView>;
  /** Passkey / Face ID sign-in; the mock resolves after the confirm sheet. */
  signIn(): Promise<AccountView>;
  cancel(subscription: string): Promise<{ receipt: AccountReceipt; view: AccountView }>;
  /** Pause a running meter the product allows to pause; nothing is charged while paused (FR-CHK-030). */
  pause(subscription: string): Promise<AccountView>;
  /** Resume a paused meter; the paused span is never billed (FR-CHK-030). */
  resume(subscription: string): Promise<AccountView>;
  emailReceipt(subscription: string): Promise<{ sent: true }>;
}

const NIMBUS = { name: "Nimbus", supportUrl: "https://nimbus.example/support" };
const HALCYON = { name: "Halcyon Transcribe", supportUrl: "https://halcyon.example/help" };

const GPU = { name: "GPU · 4090", rateUsdPerSecond: "0.004" };
const TRANSCRIBE = { name: "Live transcription", rateUsdPerSecond: "0.0009" };

/** Escrow for a cap, as the decimal string the API would return. */
function escrowUsd(capSeconds: number, rate: string): string {
  return formatUsd(maxEscrowNano(capSeconds, parseRate(rate)), 3, { symbol: false }).replace(
    /\.?0+$/,
    "",
  );
}

function meter(
  over: Pick<AccountMeter, "subscription" | "merchant" | "product" | "startedAt" | "maxDurationSeconds"> &
    Partial<AccountMeter>,
): AccountMeter {
  return {
    status: "active",
    pausedAt: null,
    fundedUsd: escrowUsd(over.maxDurationSeconds, over.product.rateUsdPerSecond),
    ...over,
  };
}

function seedState(seed: AccountSeed, now: number): { held: AccountHeld[]; meters: AccountMeter[]; receipts: AccountReceipt[] } {
  if (seed === "empty") return { held: [], meters: [], receipts: [] };

  // FR-CHK-036: one merchant-mode session waiting to be started, beside one running meter.
  if (seed === "held") {
    return {
      held: [
        {
          subscription: "sub_held1",
          merchant: { name: "Northwind Compute" },
          product: { name: "Serverless runtime" },
          heldUsd: "7.2",
          startBy: now + 600_000,
        },
      ],
      meters: [
        meter({ subscription: "sub_run1", merchant: NIMBUS, product: GPU, startedAt: now - 214_000, maxDurationSeconds: 3600 }),
      ],
      receipts: [],
    };
  }

  if (seed === "low-balance") {
    return {
      meters: [
        meter({
          subscription: "sub_low1",
          merchant: NIMBUS,
          product: GPU,
          startedAt: now - 3_400_000, // 200 s left of an hour
          maxDurationSeconds: 3600,
        }),
      ],
      held: [],
      receipts: [],
    };
  }

  const meters: AccountMeter[] = [
    meter({
      subscription: "sub_9fKq2",
      merchant: NIMBUS,
      product: GPU,
      allowPause: true,
      startedAt: now - 214_000,
      maxDurationSeconds: 3600,
    }),
    meter({
      subscription: "sub_3xTb7",
      merchant: HALCYON,
      product: TRANSCRIBE,
      startedAt: now - 1_930_000,
      maxDurationSeconds: 14_400,
    }),
  ];
  const receipts: AccountReceipt[] = [
    {
      subscription: "sub_2mVe8",
      merchant: NIMBUS,
      product: GPU,
      seconds: 83,
      amountSettledUsd: "0.332",
      refundedUsd: "14.068",
      startedAt: now - 90_000_000,
      settledAt: now - 89_917_000,
      endedReason: "canceled",
      maxDurationSeconds: 3600,
    },
    {
      subscription: "sub_8qRa4",
      merchant: HALCYON,
      product: TRANSCRIBE,
      seconds: 3600,
      amountSettledUsd: "3.24",
      refundedUsd: "0.00",
      startedAt: now - 260_000_000,
      settledAt: now - 259_996_400,
      endedReason: "cap_reached",
      maxDurationSeconds: 3600,
    },
  ];
  return { held: [], meters, receipts };
}

export function createMockAccountApi(
  opts: { now?: () => number; latencyMs?: number; seed?: AccountSeed } = {},
): AccountApi {
  const now = opts.now ?? (() => Date.now());
  const latency = opts.latencyMs ?? 300;
  const seed = opts.seed ?? "two-merchants";
  const state = seedState(seed, now());
  let signedIn = seed !== "signed-out";

  const wait = () =>
    latency > 0 ? new Promise<void>((r) => setTimeout(r, latency)) : Promise.resolve();

  /** Settle a meter at `at`, move it to receipts, and return the receipt. */
  const settle = (m: AccountMeter, at: number, reason: AccountReceipt["endedReason"]) => {
    const rate = parseRate(m.product.rateUsdPerSecond);
    const cap = parseUsd(m.fundedUsd);
    const seconds = wholeSeconds(elapsedMsOf({ startedAt: m.startedAt, now: at, pausedAt: m.pausedAt }));
    let settled = settledNano(rate, seconds);
    if (settled > cap) settled = cap; // BR-CHK-002
    const receipt: AccountReceipt = {
      subscription: m.subscription,
      merchant: m.merchant,
      product: m.product,
      seconds,
      amountSettledUsd: formatReceiptUsd(settled),
      refundedUsd: formatReceiptUsd(refundNano(cap, settled)),
      startedAt: m.startedAt,
      settledAt: at,
      endedReason: reason,
      maxDurationSeconds: m.maxDurationSeconds,
    };
    state.meters = state.meters.filter((x) => x.subscription !== m.subscription);
    state.receipts = [receipt, ...state.receipts];
    return receipt;
  };

  /**
   * The contract ends a stream the first time anyone observes it past its
   * cap, back-dated to that second (contracts FR-CON-041). Reads go
   * through here, so the page can never show a meter past its cap.
   */
  const finalizeCapped = () => {
    for (const m of [...state.meters]) {
      if (m.status !== "active") continue;
      const endsAt = capEndsAt(m.startedAt, parseUsd(m.fundedUsd), parseRate(m.product.rateUsdPerSecond));
      if (endsAt !== null && now() >= endsAt) settle(m, endsAt, "cap_reached");
    }
  };

  const view = (): AccountView => {
    if (!signedIn) return { status: "signed_out" };
    finalizeCapped();
    return {
      status: "signed_in",
      held: state.held,
      meters: [...state.meters].sort((a, b) => b.startedAt - a.startedAt).map((m) => ({ ...m })),
      receipts: [...state.receipts].sort((a, b) => b.settledAt - a.settledAt).map((r) => ({ ...r })),
    };
  };

  return {
    async getView() {
      await wait();
      return view();
    },

    async signIn() {
      await wait();
      signedIn = true;
      return view();
    },

    async cancel(subscription) {
      await wait();
      finalizeCapped();
      const held = state.held.findIndex((x) => x.subscription === subscription);
      if (held >= 0) {
        // FR-CHK-036: stopping before the merchant starts settles nothing; the whole deposit comes back.
        const [h] = state.held.splice(held, 1);
        const t = now();
        const receipt: AccountReceipt = {
          subscription: h!.subscription,
          merchant: h!.merchant,
          product: { name: h!.product.name, rateUsdPerSecond: "0.002" },
          seconds: 0,
          amountSettledUsd: "0.00",
          refundedUsd: formatReceiptUsd(parseUsd(h!.heldUsd)),
          startedAt: 0,
          settledAt: t,
          endedReason: "canceled",
          maxDurationSeconds: 3600,
        };
        state.receipts.unshift(receipt);
        return { receipt, view: view() };
      }
      const m = state.meters.find((x) => x.subscription === subscription);
      if (!m) throw new AccountApiError("not_found", "That meter is not running");
      const receipt = settle(m, now(), "canceled");
      return { receipt, view: view() };
    },

    async pause(subscription) {
      await wait();
      const m = state.meters.find((x) => x.subscription === subscription);
      if (!m || !m.allowPause) throw new AccountApiError("invalid_state", "This meter cannot be paused.");
      if (m.status === "paused") throw new AccountApiError("invalid_state", "The meter is already paused.");
      m.status = "paused";
      m.pausedAt = now();
      return view();
    },

    async resume(subscription) {
      await wait();
      const m = state.meters.find((x) => x.subscription === subscription);
      if (!m || m.status !== "paused" || m.pausedAt === null) throw new AccountApiError("invalid_state", "The meter is not paused.");
      // Shift start forward by the paused span so elapsed excludes the pause.
      m.startedAt += now() - m.pausedAt;
      m.status = "active";
      m.pausedAt = null;
      return view();
    },


    async emailReceipt(subscription) {
      await wait();
      if (!state.receipts.some((r) => r.subscription === subscription)) {
        throw new AccountApiError("not_found", "No such receipt");
      }
      return { sent: true };
    },
  };
}
