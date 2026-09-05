/**
 * Event types (FR-SDK-023; detailed doc §5.1, §5.3). The union is exhaustive
 * for the six MVP types and keeps a fallback member for types this SDK version
 * does not know: a valid signature on a new type is still a genuine event.
 */

export type EventType =
  | "checkout.session.completed"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.canceled"
  | "invoice.settled"
  | "invoice.payment_failed";

export type SubscriptionStatus = "incomplete" | "active" | "paused" | "canceled";

interface EventBase {
  id: `evt_${string}` | string;
  object: "event";
  created: number;
  livemode: boolean;
  pending_webhooks: number;
  request?: { id: string | null; idempotency_key: string | null };
}

export interface SubscriptionObject {
  id: string;
  object: "subscription";
  status: SubscriptionStatus;
  product: string;
  customer: string;
  rate_usd_per_second: string;
  started_at: number | null;
  paused_at: number | null;
  canceled_at: number | null;
  ended_reason: "canceled" | "cap_reached" | null;
  max_duration_seconds: number | null;
  max_escrow_usd: string | null;
  funded_usd: string;
  settled_usd: string;
  seconds_elapsed: number;
  currency: "ausd";
  livemode: boolean;
  created: number;
  [extra: string]: unknown;
}

/** §5.3: cumulative totals for the subscription (BR-API-008). */
export interface CanceledSubscriptionObject extends SubscriptionObject {
  status: "canceled";
  seconds_elapsed: number;
  amount_settled: string;
}

export interface InvoiceObject {
  id: string;
  object: "invoice";
  subscription: string;
  period_start: number;
  period_end: number;
  seconds: number;
  amount_settled: string;
  gross: string;
  fee: string;
  net: string;
  currency: "ausd";
  status: "paid" | "failed";
  livemode: boolean;
  created: number;
  [extra: string]: unknown;
}

export interface CheckoutSessionCompletedObject {
  id: string;
  object: "checkout.session";
  status: "complete";
  subscription: string;
  customer: string;
  product: string;
  livemode: boolean;
  created: number;
  [extra: string]: unknown;
}

export type ElapseEvent =
  | (EventBase & { type: "checkout.session.completed"; data: { object: CheckoutSessionCompletedObject } })
  | (EventBase & { type: "subscription.created"; data: { object: SubscriptionObject } })
  | (EventBase & { type: "subscription.updated"; data: { object: SubscriptionObject } })
  | (EventBase & { type: "subscription.canceled"; data: { object: CanceledSubscriptionObject } })
  | (EventBase & { type: "invoice.settled"; data: { object: InvoiceObject } })
  | (EventBase & { type: "invoice.payment_failed"; data: { object: InvoiceObject } })
  /**
   * A type newer than this SDK version. It is verified and returned all the
   * same (a valid signature is what makes it genuine); switch on `type` and
   * ignore what you do not handle. `data.object` is typed `never` here so that
   * narrowing on a known `type` still gives you the known shape; in a
   * `default` branch cast it, e.g. `evt.data.object as Record<string, unknown>`.
   */
  | (EventBase & { type: string; data: { object: never } });
