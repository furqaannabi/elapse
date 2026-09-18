import { createHmac } from "node:crypto";

/** Signs exactly as the platform does (doc §4.4): `t=<unix>,v1=hmac_sha256(secret, `${t}.${body}`)`. */
export function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function event(type: string, object: Record<string, unknown>, id = "evt_1S2bXYZ"): string {
  return JSON.stringify({ id, object: "event", type, created: 1_700_000_000, livemode: false, pending_webhooks: 1, data: { object } });
}

const SUB = {
  id: "sub_4QeABC", object: "subscription", status: "active", product: "prod_9f2", customer: "cus_7Ha",
  rate_usd_per_second: "0.002",
};

export const created = (over: Record<string, unknown> = {}, id?: string) =>
  event("subscription.created", { ...SUB, started_at: 1_700_000_000, ...over }, id);

/** FR-EXM-133: a merchant-mode subscription is created `incomplete` — authorised, not running. */
export const authorised = (over: Record<string, unknown> = {}, id?: string) =>
  event("subscription.created", { ...SUB, status: "incomplete", ...over }, id ?? "evt_authorised");

/** FR-EXM-133: the meter started on chain. */
export const started = (over: Record<string, unknown> = {}, id?: string) =>
  event("subscription.updated", { ...SUB, status: "active", started_at: 1_700_000_040, ...over }, id ?? "evt_started");

export const canceled = (over: Record<string, unknown> = {}, id?: string) =>
  event("subscription.canceled", { ...SUB, status: "canceled", seconds_elapsed: 62, amount_settled: "0.12", ...over }, id);

export const completed = (over: Record<string, unknown> = {}, id?: string) =>
  event(
    "checkout.session.completed",
    { id: "cs_7Ha", object: "checkout.session", status: "complete", subscription: "sub_4QeABC", customer: "cus_7Ha", ...over },
    id ?? "evt_completed",
  );
