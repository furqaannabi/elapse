import { createHmac } from "node:crypto";

/** Signs exactly as the platform does (doc §4.4): `t=<unix>,v1=hmac_sha256(secret, `${t}.${body}`)`. */
export function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function event(type: string, object: Record<string, unknown>, id = "evt_1S2bXYZ"): string {
  return JSON.stringify({ id, object: "event", type, created: 1_700_000_000, livemode: false, pending_webhooks: 1, data: { object } });
}

export const canceled = (over: Record<string, unknown> = {}) =>
  event("subscription.canceled", {
    id: "sub_4QeABC", object: "subscription", status: "canceled", product: "prod_9f2", customer: "cus_7Ha",
    rate_usd_per_second: "0.004", seconds_elapsed: 83, amount_settled: "0.33", ...over,
  });
