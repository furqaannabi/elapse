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

describe("deriveView with the real API's session states", () => {
  it("a complete session with a running meter is running, not used (FR-API-033)", async () => {
    const { deriveView } = await import("./view");
    const now = 1_757_000_000_000;
    const session = {
      id: "cs_x" as const, status: "complete" as const, expiresAt: now + 3_600_000,
      merchant: { name: "N", successUrl: "https://n.example/ok", cancelUrl: "https://n.example/no" },
      product: { id: "prod_1" as const, name: "GPU", rateUsdPerSecond: "0.004", allowPause: false, status: "active" as const },
      customer: { id: "cus_1" as const },
      subscription: { id: "sub_1" as const, status: "active" as const, startedAt: now - 10_000, pausedAt: null, canceledAt: null, maxDurationSeconds: 3600, fundedUsd: "14.4", rateUsdPerSecond: "0.004" },
    };
    expect(deriveView(session, now)).toBe("running");
    expect(deriveView({ ...session, subscription: { ...session.subscription, status: "paused" as const, pausedAt: now - 1000 } }, now)).toBe("paused");
    expect(deriveView({ ...session, subscription: null }, now)).toBe("used");
  });
});

describe("FR-CHK-027 afterError: what the page does with a failed action", () => {
  it("sign_in_required opens the sign-in sheet with 'Sign in again'; unconfigured and others only toast", async () => {
    const { afterError } = await import("./view");
    const { CheckoutApiError } = await import("./mock-api");
    expect(afterError(new CheckoutApiError("sign_in_required", "Sign in again."))).toEqual({ message: "Sign in again.", openSignIn: true });
    expect(afterError(new CheckoutApiError("unconfigured", "Checkout is not set up yet."))).toEqual({ message: "Checkout is not set up yet.", openSignIn: false });
    expect(afterError(new CheckoutApiError("invalid_state", "Choose how long first."))).toEqual({ message: "Choose how long first.", openSignIn: false });
    expect(afterError("boom")).toEqual({ message: "Something went wrong", openSignIn: false });
  });
});

describe("FR-CHK-002 actionGate: what the primary action does while the device's sign-in is being restored", () => {
  it("holds while the provider is restoring, asks for sign-in when a wallet is needed and absent, otherwise proceeds", async () => {
    const { actionGate } = await import("./view");
    // provider still restoring: hold, never flicker between states
    expect(actionGate({ ready: false, walletReady: false, needsWallet: true })).toBe("pending");
    expect(actionGate({ ready: false, walletReady: false, needsWallet: false })).toBe("pending");
    // restored without a session on this device, on a step that signs things: sign in first
    expect(actionGate({ ready: true, walletReady: false, needsWallet: true })).toBe("signin");
    // restored with the wallet, or on a step that needs none: go
    expect(actionGate({ ready: true, walletReady: true, needsWallet: true })).toBe("ok");
    expect(actionGate({ ready: true, walletReady: false, needsWallet: false })).toBe("ok");
  });
});

describe("FR-CHK-034 held view", () => {
  const held = sub({ status: "incomplete", maxDurationSeconds: 3600, fundedUsd: "14.4", hold: { startBy: NOW + 600_000, heldUsd: "14.4" } });

  it("FR_CHK_034_a_held_subscription_shows_the_held_view_never_start_or_used", () => {
    // Merchant mode completes the session at funding (FR-API-033), so "complete" must not read as used.
    expect(deriveView({ ...base, status: "complete", customer: { id: "cus_1" }, subscription: held }, NOW)).toBe("held");
    expect(deriveView({ ...base, customer: { id: "cus_1" }, subscription: held }, NOW)).toBe("held");
  });

  it("FR_CHK_034_an_incomplete_subscription_without_a_hold_still_shows_start", () => {
    expect(deriveView({ ...base, customer: { id: "cus_1" }, subscription: sub({ status: "incomplete", fundedUsd: "14.4" }) }, NOW)).toBe("ready");
  });
});
