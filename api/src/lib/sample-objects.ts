import type { EventType } from "./event-types";

/**
 * Payloads for `POST /v1/webhook_endpoints/:id/test` (FR-API-061): shaped like
 * the real objects so a merchant's handler can be exercised end to end.
 * Ids are obviously synthetic.
 */
export function sampleObject(type: EventType, livemode: boolean, now = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  const sub = {
    id: "sub_test00000000000",
    object: "subscription",
    status: "active",
    product: "prod_test0000000000",
    customer: "cus_test00000000000",
    rate_usd_per_second: "0.004",
    started_at: now - 83,
    paused_at: null,
    canceled_at: null,
    ended_reason: null,
    max_duration_seconds: 3600,
    max_escrow_usd: "14.4",
    funded_usd: "14.4",
    settled_usd: "0",
    seconds_elapsed: 83,
    currency: "ausd",
    livemode,
    created: now - 90,
  };
  const invoice = {
    id: "in_test000000000000",
    object: "invoice",
    subscription: sub.id,
    period_start: now - 83,
    period_end: now,
    seconds: 83,
    amount_settled: "0.332",
    gross: "0.332",
    fee: "0.00332",
    net: "0.32868",
    currency: "ausd",
    status: "paid",
    livemode,
    created: now,
  };
  switch (type) {
    case "checkout.session.completed":
      return { id: "cs_test000000000000", object: "checkout.session", status: "complete", subscription: sub.id, customer: sub.customer, product: sub.product, livemode, created: now - 90 };
    case "subscription.created":
      return sub;
    case "subscription.updated":
      return { ...sub, status: "paused", paused_at: now };
    case "subscription.canceled":
      return { ...sub, status: "canceled", canceled_at: now, ended_reason: "canceled", settled_usd: "0.332", amount_settled: "0.332" };
    case "invoice.settled":
      return invoice;
    case "invoice.payment_failed":
      return { ...invoice, status: "failed", seconds: 0, amount_settled: "0", gross: "0", fee: "0", net: "0" };
  }
}
