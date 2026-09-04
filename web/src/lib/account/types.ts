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
  merchant: AccountMerchant;
  product: { name: string; rateUsdPerSecond: string };
  status: Extract<SubscriptionStatus, "active" | "paused">;
  startedAt: number;
  pausedAt: number | null;
  /** The cap the subscriber authorised, in seconds (FR-CHK-003). */
  maxDurationSeconds: number;
  /** Escrow held for the session (rate × cap), USD decimal string. */
  fundedUsd: string;
};

/** One finished session, in the words the receipt uses. */
export type AccountReceipt = {
  invoice: `in_${string}`;
  subscription: `sub_${string}`;
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

/** Signed out, or signed in with everything the page shows. */
export type AccountView =
  | { status: "signed_out" }
  | { status: "signed_in"; meters: AccountMeter[]; receipts: AccountReceipt[] };
