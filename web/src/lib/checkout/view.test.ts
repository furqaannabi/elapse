/**
 * View derivation for the hosted checkout: one pure function turns a
 * session plus "now" into the screen to show.
 *
 * FR-CHK-004 (start → running), FR-CHK-006 (low balance), FR-CHK-007
 * (the session ends at its cap), FR-CHK-008 (canceled → receipt),
 * FR-CHK-010 (expired / used / archived), FR-CHK-002 (sign-in first).
 */
import { describe, expect, it } from "vitest";
import type { CheckoutSession, Subscription } from "./types";
import { deriveView } from "./view";

const NOW = 1_756_800_000_000;

const base: CheckoutSession = {
  id: "cs_test",
  status: "open",
  merchant: {
    name: "Nimbus",
    successUrl: "https://nimbus.example/ok",
    cancelUrl: "https://nimbus.example/cancel",
  },
  product: {
    id: "prod_gpu",
    name: "GPU · 4090",
    rateUsdPerSecond: "0.004",
    allowPause: false,
    status: "active",
  },
  customer: null,
  subscription: null,
  expiresAt: NOW + 3_600_000,
};

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "sub_test",
  status: "incomplete",
  startedAt: null,
  pausedAt: null,
  canceledAt: null,
  maxDurationSeconds: 0,
  fundedUsd: "0",
  rateUsdPerSecond: "0.004",
  ...over,
});

describe("deriveView", () => {
  it("expired session → expired, regardless of anything else", () => {
    expect(deriveView({ ...base, status: "expired" }, NOW)).toBe("expired");
    expect(deriveView({ ...base, expiresAt: NOW - 1 }, NOW)).toBe("expired");
  });

  it("archived product → archived", () => {
    expect(
      deriveView({ ...base, product: { ...base.product, status: "archived" } }, NOW),
    ).toBe("archived");
  });

  it("complete session without a subscription → used", () => {
    expect(deriveView({ ...base, status: "complete" }, NOW)).toBe("used");
  });

  it("no customer → signin", () => {
    expect(deriveView(base, NOW)).toBe("signin");
  });

  it("customer but no cap chosen → cap", () => {
    const s = { ...base, customer: { id: "cus_1" as const } };
    expect(deriveView(s, NOW)).toBe("cap");
    expect(deriveView({ ...s, subscription: sub() }, NOW)).toBe("cap");
  });

  it("cap chosen, not started → ready", () => {
    const s = { ...base, customer: { id: "cus_1" as const }, subscription: sub({ maxDurationSeconds: 2500, fundedUsd: "10" }) };
    expect(deriveView(s, NOW)).toBe("ready");
  });

  it("active with plenty of funds → running", () => {
    const s = {
      ...base,
      customer: { id: "cus_1" as const },
      subscription: sub({ status: "active", maxDurationSeconds: 2500, fundedUsd: "10", startedAt: NOW - 10_000 }),
    };
    expect(deriveView(s, NOW)).toBe("running");
  });

  it("active with < 5 min of runtime left → low_balance", () => {
    // $10 at $0.004/s = 2500 s. 2500 - 299 = 2201 s elapsed leaves 299 s.
    const s = {
      ...base,
      customer: { id: "cus_1" as const },
      subscription: sub({ status: "active", maxDurationSeconds: 2500, fundedUsd: "10", startedAt: NOW - 2_201_000 }),
    };
    expect(deriveView(s, NOW)).toBe("low_balance");
  });

  it("active past its cap → canceled: the session ends, it never pauses (FR-CHK-007)", () => {
    const s = {
      ...base,
      customer: { id: "cus_1" as const },
      subscription: sub({ status: "active", maxDurationSeconds: 2500, fundedUsd: "10", startedAt: NOW - 2_600_000 }),
    };
    expect(deriveView(s, NOW)).toBe("canceled");
  });

  it("paused is only ever a manual pause", () => {
    const s = {
      ...base,
      customer: { id: "cus_1" as const },
      subscription: sub({
        status: "paused",
        maxDurationSeconds: 2500,
        fundedUsd: "10",
        startedAt: NOW - 5000,
        pausedAt: NOW - 1000,
        pauseReason: "user",
      }),
    };
    expect(deriveView(s, NOW)).toBe("paused");
  });

  it("canceled → canceled receipt, even when the session is complete", () => {
    const s = {
      ...base,
      status: "complete" as const,
      customer: { id: "cus_1" as const },
      subscription: sub({ status: "canceled", maxDurationSeconds: 2500, fundedUsd: "10", startedAt: NOW - 90_000, canceledAt: NOW - 7_000 }),
    };
    expect(deriveView(s, NOW)).toBe("canceled");
  });
});
