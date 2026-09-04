/**
 * Dashboard domain types — the shapes the merchant dashboard reads from
 * `/v1/dashboard/*`. camelCase for the client; ids carry their prefixes;
 * money is a decimal USD string until it meets the meter math.
 *
 * Maps to: docs/specs/dashboard-frd.md "Data"; technical-design.md §2.
 */

import type { Mode } from "./mode";

export type { Mode };

export type Branding = {
  name: string;
  logoUrl?: string;
  accent?: string;
  supportUrl?: string;
};

export type Merchant = {
  id: `mrc_${string}`;
  email: string;
  /** Null until first-run capture (FR-DSH-013). */
  name: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  /** Where settled funds arrive. Null until set. */
  payoutAddress: string | null;
  /** Platform fee in basis points; 100 = 1 %. */
  feeBps: number;
  branding: Branding;
  createdAt: number;
};

export type ChecklistState = {
  hasProduct: boolean;
  hasSecretKey: boolean;
  hasEndpoint: boolean;
  hasSucceededDelivery: boolean;
};

export type KeyStatus = "active" | "expiring" | "expired" | "revoked";

/** A secret key row. The plaintext is never in this shape (BR-DSH-001). */
export type ApiKey = {
  id: `key_${string}`;
  livemode: boolean;
  name: string;
  /** e.g. "sk_test_4f2a" — enough to recognise, never enough to use. */
  prefix: string;
  last4: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** Set by a roll; the key keeps working until then. */
  expiresAt: number | null;
  /** Derived from the timestamps at read time. */
  status: KeyStatus;
};

export type KeyList = {
  /** The one publishable key for the mode, shown in full. */
  publishable: string;
  secret: ApiKey[];
};

export type ProductStatus = "active" | "archived";

export type Product = {
  id: `prod_${string}`;
  livemode: boolean;
  name: string;
  description: string | null;
  /** USD per second as a decimal string, e.g. "0.004". */
  rateUsdPerSecond: string;
  allowPause: boolean;
  status: ProductStatus;
  activeSubscriptions: number;
  createdAt: number;
};

export type Customer = {
  id: `cus_${string}`;
  livemode: boolean;
  email: string | null;
  createdAt: number;
  totalSettledUsd: string;
  subscriptionCount: number;
};

export type SubscriptionStatus = "incomplete" | "active" | "paused" | "canceled";
/** Pause is only ever manual; a meter that reaches its cap ends (FR-CHK-007). */
export type PauseReason = "user";
/** Why a subscription ended: the subscriber stopped it, or its cap ran out. */
export type EndedReason = "canceled" | "cap_reached";

export type Subscription = {
  id: `sub_${string}`;
  livemode: boolean;
  status: SubscriptionStatus;
  product: Pick<Product, "id" | "name">;
  customer: Pick<Customer, "id" | "email">;
  rateUsdPerSecond: string;
  startedAt: number | null;
  pausedAt: number | null;
  canceledAt: number | null;
  pauseReason?: PauseReason;
  endedReason?: EndedReason;
  fundedUsd: string;
  settledUsd: string;
  checkoutSession: `cs_${string}`;
  createdAt: number;
};

export type Invoice = {
  id: `inv_${string}`;
  livemode: boolean;
  subscription: `sub_${string}`;
  customer: Pick<Customer, "id" | "email">;
  settledAt: number;
  seconds: number;
  grossUsd: string;
  feeUsd: string;
  netUsd: string;
  txId: string;
};

export type EventType =
  | "checkout.session.completed"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "invoice.settled"
  | "invoice.payment_failed";

export const EVENT_TYPES: readonly EventType[] = [
  "checkout.session.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "invoice.settled",
  "invoice.payment_failed",
];

export type DeliveryState = "pending" | "delivered" | "failed";

export type Event = {
  id: `evt_${string}`;
  livemode: boolean;
  type: EventType;
  objectId: string;
  createdAt: number;
  pendingWebhooks: number;
  /** Rolled up from this event's deliveries. */
  deliveryState: DeliveryState;
  payload: Record<string, unknown>;
};

export type WebhookEndpoint = {
  id: `wh_${string}`;
  livemode: boolean;
  url: string;
  /** Subscribed types, or "*" for the whole catalog. */
  events: EventType[] | "*";
  disabled: boolean;
  /** Succeeded ÷ finished deliveries over the last 7 days; 1 when none. */
  successRate7d: number;
  /** Set by a secret roll; the old secret is honoured until then. */
  previousSecretExpiresAt: number | null;
  createdAt: number;
};

export type DeliveryStatus = "pending" | "succeeded" | "failed" | "exhausted" | "skipped";

export type Attempt = {
  at: number;
  manual: boolean;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseCode: number | null;
  responseBody: string | null;
  error: string | null;
};

export type Delivery = {
  id: `dlv_${string}`;
  livemode: boolean;
  event: Pick<Event, "id" | "type" | "objectId" | "createdAt">;
  endpoint: Pick<WebhookEndpoint, "id" | "url">;
  status: DeliveryStatus;
  attempt: number;
  maxAttempts: 8;
  lastResponseCode: number | null;
  nextAttemptAt: number | null;
  attempts: Attempt[];
};

export type LedgerKind = "deposit" | "settlement" | "fee" | "refund";

/** One money movement, from an indexed contract event. Append-only (BR-DSH-011). */
export type LedgerEntry = {
  id: `led_${string}`;
  livemode: boolean;
  kind: LedgerKind;
  /** Absolute USD; the UI signs it from the merchant's view. */
  amountUsd: string;
  subscription: `sub_${string}`;
  customer: Pick<Customer, "id" | "email">;
  txId: string;
  blockTime: number;
  /** Set when a re-org replaced this row. */
  reversedBy: `led_${string}` | null;
  invoice: `inv_${string}` | null;
};

export type Balance = {
  payoutAddress: string | null;
  /** AUSD at the payout address, as USD. */
  ausdUsd: string;
  settledThisMonthNetUsd: string;
  asOf: number;
};

export type NotificationKind = "endpoint_exhausted" | "key_expiring" | "secret_expiring" | "payment_failed" | "first_delivery";

export type Notification = {
  id: `ntf_${string}`;
  livemode: boolean;
  kind: NotificationKind;
  summary: string;
  objectId: string;
  href: string;
  createdAt: number;
  readAt: number | null;
  emailedAt: number | null;
};

export type NotificationSettings = { emailOnExhausted: boolean; emailOnExpiring: boolean };

export type AuditAction =
  | "signin"
  | "key.created"
  | "key.rolled"
  | "key.revoked"
  | "secret.revealed"
  | "secret.rolled"
  | "endpoint.added"
  | "endpoint.changed"
  | "endpoint.disabled"
  | "endpoint.enabled"
  | "payout_address.changed"
  | "delivery.resent"
  | "test_data.deleted";

export type AuditEntry = { id: `aud_${string}`; at: number; actor: string; action: AuditAction; target: string; ip: string };

export type Overview = {
  runningNow: number;
  accruedTodayUsd: string;
  settledWeekNetUsd: string;
  failedPaymentsWeek: number;
  running: Subscription[];
  recentEvents: Event[];
};
