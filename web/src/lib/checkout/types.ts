/**
 * Checkout domain types — the shapes the hosted checkout reads.
 *
 * These mirror the API resources in the technical design (§2, §3) using
 * camelCase for the client. Ids carry their prefixes. Money is a decimal
 * USD string until it meets the meter math, which converts to nano-dollars.
 *
 * Maps to: FR-CHK-001, FR-CHK-014; docs/specs/technical-design.md.
 */

export type SubscriptionStatus = "incomplete" | "active" | "paused" | "canceled";
export type SessionStatus = "open" | "complete" | "expired";
/**
 * Pause is only ever manual. A meter that reaches its cap ends; it never
 * pauses, because the cap cannot be raised mid-session (FR-CHK-007).
 */
export type PauseReason = "user";
/** Why a subscription ended: the subscriber stopped it, or its cap ran out. */
export type EndedReason = "canceled" | "cap_reached";

/** What a merchant may brand on the hosted page. Layout and copy are ours. */
export type Branding = {
  name: string;
  logoUrl?: string;
  /** CSS colour; falls back to the design system's amber when absent. */
  accent?: string;
  supportUrl?: string;
};

export type Product = {
  id: `prod_${string}`;
  name: string;
  /** USD per second as a decimal string, e.g. "0.004". */
  rateUsdPerSecond: string;
  allowPause: boolean;
  status: "active" | "archived";
};

export type Subscription = {
  id: `sub_${string}`;
  status: SubscriptionStatus;
  startedAt: number | null;
  pausedAt: number | null;
  canceledAt: number | null;
  pauseReason?: PauseReason;
  endedReason?: EndedReason;
  /**
   * The cap the subscriber authorised, in seconds. The session ends here
   * (FR-CHK-007) and it is immutable once the meter is running.
   */
  maxDurationSeconds: number;
  /** Escrow held for this subscription (rate × cap), USD decimal string. */
  fundedUsd: string;
  /** Snapshot of the product rate at start. */
  rateUsdPerSecond: string;
};

export type Customer = {
  id: `cus_${string}`;
  email?: string;
};

export type CheckoutSession = {
  id: `cs_${string}`;
  status: SessionStatus;
  merchant: Branding & { successUrl: string; cancelUrl: string };
  product: Product;
  customer: Customer | null;
  subscription: Subscription | null;
  /** Epoch ms. */
  expiresAt: number;
  /**
   * The subscriber has signed in on this device but no Customer exists yet:
   * the real API creates it at `prepare`, once a cap is chosen (FR-API-032).
   */
  signedIn?: boolean;
};

/** Everything the page can show. Derived, never stored. */
export type CheckoutView =
  | "expired"
  | "used"
  | "archived"
  | "signin"
  | "cap"
  | "ready"
  | "running"
  | "low_balance"
  | "paused"
  | "canceled";
