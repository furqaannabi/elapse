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
  /** FR-CHK-035: `merchant` means billing waits for the merchant to start the session. Absent on older payloads. */
  startMode?: "checkout" | "merchant";
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
  /**
   * The server's totals once the meter has stopped (BR-CHK-003): whole seconds
   * billed (paused time excluded) and what was settled. Set by the real API;
   * the mock and a predicted cap end leave it out and the receipt recounts.
   */
  settled?: { secondsElapsed: number; settledUsd: string };
  /**
   * FR-CHK-034: set only while the subscriber has funded a merchant-mode session the merchant has
   * not started. `startBy` (epoch ms) is when it all comes back if it never starts; `heldUsd` is
   * what is actually held, not the cap.
   */
  hold?: { startBy: number; heldUsd: string };
  /** FR-API-137: `merchant` means the merchant starts the meter, not the subscriber's authorisation. Absent on older payloads. */
  startMode?: "checkout" | "merchant";
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
  /** The cap chosen on the session this one was opened from with Start again (FR-CHK-007); the cap step preselects it. */
  lastMaxDurationSeconds?: number;
  /** The newest session opened from this one with Start again (FR-CHK-007): the receipt links there instead of offering the button. */
  restartedAs?: `cs_${string}`;
  /**
   * The subscriber has signed in on this device but no Customer exists yet:
   * the real API creates it at `prepare`, once a cap is chosen (FR-API-032).
   */
  signedIn?: boolean;
};

/** Everything the page can show. Derived, never stored. */
export type CheckoutView =
  | "expired"
  /** FR-CHK-034: funded, the merchant has not started the meter. */
  | "held"
  | "used"
  | "archived"
  | "signin"
  | "cap"
  | "ready"
  | "running"
  | "low_balance"
  | "paused"
  | "canceled";

/**
 * What the checkout knows about the signed-in wallet before the cap step (FR-CHK-031). Only
 * `token` and `network` are ever shown, and only on the Add funds step.
 */
export type CheckoutBalance = {
  /** USD decimal string. */
  balanceUsd: string;
  /** True when the subscriber must fund the wallet themselves (AUSD); false when test dollars are topped up for them. */
  needsFunding: boolean;
  receiveAddress: string;
  token: string;
  network: string;
};
