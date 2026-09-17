/**
 * Subscriber account types — what `/account` reads.
 *
 * The page spans merchants, so every row carries the merchant it belongs
 * to. The subscriber's identity is their passkey wallet address, which is
 * never part of these shapes: the API resolves it from the session and
 * returns only what the subscriber may see (FR-CHK-022, API FR-API-121).
 *
 * Maps to: FR-CHK-016–026; docs/specs/checkout-frd.md Surface 4.
 */
import type { SubscriptionStatus } from "@/lib/checkout/types";

/** The merchant as a subscriber sees them: name, mark, and a way to get help. */
export type AccountMerchant = {
  name: string;
  logoUrl?: string;
  supportUrl?: string;
};

/** One running or paused meter, on one product, at one merchant. */
export type AccountMeter = {
  subscription: `sub_${string}`;
  /** Started from a merchant's test link (ADR 2026-09-07 account on real data): the row carries a "Test" tag. */
  test?: boolean;
  merchant: AccountMerchant;
  product: { name: string; rateUsdPerSecond: string };
  status: Extract<SubscriptionStatus, "active" | "paused">;
  /** The product allows the subscriber to pause (FR-CHK-030); absent means no Pause button. */
  allowPause?: boolean;
  startedAt: number;
  pausedAt: number | null;
  /** The cap the subscriber authorised, in seconds (FR-CHK-003). */
  maxDurationSeconds: number;
  /** Escrow held for the session (rate × cap), USD decimal string. */
  fundedUsd: string;
  /** FR-CHK-037: a merchant-mode meter the merchant started; the subscriber cannot stop or pause it. */
  merchantControlled?: boolean;
};

/** One finished session, in the words the receipt uses. One per ended meter, keyed by the subscription. */
export type AccountReceipt = {
  subscription: `sub_${string}`;
  /** The session it ran under, for Start again (FR-CHK-020, FR-API-126). */
  session?: `cs_${string}`;
  /** Already started again: the newer session, linked instead of the button. */
  restartedAs?: `cs_${string}`;
  test?: boolean;
  merchant: AccountMerchant;
  product: { name: string; rateUsdPerSecond: string };
  seconds: number;
  /** Gross, which is what the subscriber paid; a fee is never shown here. */
  amountSettledUsd: string;
  refundedUsd: string;
  startedAt: number;
  settledAt: number;
  endedReason: "canceled" | "cap_reached";
  maxDurationSeconds: number;
};

/**
 * FR-CHK-036: money the subscriber has put up for a merchant-mode session the merchant has not
 * started. Nothing is accruing, so it has no rate or start time; `startBy` (epoch ms) is when it all
 * comes back if the merchant never starts.
 */
export type AccountHeld = {
  subscription: `sub_${string}`;
  test?: boolean;
  merchant: AccountMerchant;
  product: { name: string };
  heldUsd: string;
  startBy: number;
};

/** Signed out, or signed in with everything the page shows. */
export type AccountView =
  | { status: "signed_out" }
  | { status: "signed_in"; held: AccountHeld[]; meters: AccountMeter[]; receipts: AccountReceipt[] };
