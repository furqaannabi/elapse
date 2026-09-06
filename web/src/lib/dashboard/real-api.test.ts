import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealDashboardApi, keyStatus, mapAudit, mapDelivery, mapEndpoint, mapEvent, mapKey, mapLedger, mapMerchant, mapNotification, mapProduct, mapSubscription, receiptOf } from "./real-api";

const BASE = "http://api.test";
const T0 = 1_757_000_000;
let calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }>;
let responses: unknown[];

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = (responses.shift() ?? {}) as { __status?: number };
    return new Response(JSON.stringify(next), { status: next.__status ?? 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const profile = {
  id: "mrc_1", name: null, email: "m@acme.test", support_email: null, support_url: null, payout_address: "0x1111111111111111111111111111111111111111", fee_bps: 100,
  branding: { display_name: null, logo_url: null, accent: null, support_url: null },
  notifications: { endpoint_exhausted_email: true, key_expiry_email: true },
  checklist: { key_created: true, product_created: false, endpoint_created: false, first_delivery_succeeded: false }, created: T0,
};

describe("mapping", () => {
  it("merchant: null name before first run; branding falls back to the name", () => {
    expect(mapMerchant(profile)).toMatchObject({ id: "mrc_1", name: null, payoutAddress: "0x1111111111111111111111111111111111111111", feeBps: 100, createdAt: T0 * 1000 });
    expect(mapMerchant({ ...profile, name: "Acme", branding: { ...profile.branding, display_name: "Acme Cloud", accent: "#4f46e5" } }).branding).toEqual({ name: "Acme Cloud", accent: "#4f46e5" });
  });
  it("key status from timestamps; prefix is recognisable, never usable", () => {
    const k = { id: "key_1", kind: "sk" as const, name: "default", livemode: false, last4: "4f2a", redacted: "sk_test_…4f2a", created: T0, last_used_at: null, revoked_at: null, expires_at: null };
    expect(mapKey(k, T0 * 1000)).toMatchObject({ prefix: "sk_test_", last4: "4f2a", status: "active", lastUsedAt: null });
    expect(keyStatus({ revoked_at: T0, expires_at: null })).toBe("revoked");
    expect(keyStatus({ revoked_at: null, expires_at: T0 + 100 }, T0 * 1000)).toBe("expiring");
    expect(keyStatus({ revoked_at: null, expires_at: T0 - 1 }, T0 * 1000)).toBe("expired");
  });
  it("endpoint: '*' collapses; delivery: retrying after a failure reads as failed", () => {
    expect(mapEndpoint({ id: "wh_1", url: "https://x", events: ["*"], disabled: false, livemode: false, created: T0, previous_secret_expires_at: null, success_rate_7d: 0.75 })).toMatchObject({ events: "*", successRate7d: 0.75 });
    const d = { id: "dlv_1", event: "evt_1", endpoint: "wh_1", status: "retrying" as const, attempt: 2, next_attempt_at: T0 + 30, livemode: false, created: T0, resend_requested: false, max_attempts: 8, event_type: "subscription.created", event_created: T0, endpoint_url: "https://x", last_attempt: { n: 2, manual: false, actor: null, sent_at: T0 + 1, duration_ms: 12, status_code: 500, error: null, request_headers: { "x-elapse-signature": "t=1,v1=a" }, response_excerpt: "boom" } };
    const m = mapDelivery(d, "{}");
    expect(m).toMatchObject({ status: "failed", lastResponseCode: 500, nextAttemptAt: (T0 + 30) * 1000, event: { type: "subscription.created" }, endpoint: { url: "https://x" } });
    expect(m.attempts[0]).toMatchObject({ responseCode: 500, responseBody: "boom", requestBody: "{}" });
    expect(mapDelivery({ ...d, status: "queued", last_attempt: null }).status).toBe("pending");
  });
  it("event: object id and delivery state pass through", () => {
    expect(mapEvent({ id: "evt_1", type: "invoice.settled", created: T0, livemode: false, data: { object: { id: "in_1" } }, pending_webhooks: 0, object_id: "in_1", delivery_state: "delivered" })).toMatchObject({ objectId: "in_1", deliveryState: "delivered", payload: { id: "in_1" } });
  });
});

describe("real DashboardApi", () => {
  const api = () => createRealDashboardApi({ baseUrl: BASE, getMode: () => "test" });

  it("sends credentials, the mode header, and an idempotency key on writes", async () => {
    responses = [{ ...profile, name: "Acme" }];
    await api().completeFirstRun({ name: "Acme" });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/dashboard/me`, body: { name: "Acme" } });
    expect(calls[0]!.headers["x-elapse-mode"]).toBe("test");
    expect(calls[0]!.headers["idempotency-key"]).toMatch(/^idem_/);
    responses = [profile];
    await api().me();
    expect(calls[1]!.headers["idempotency-key"]).toBeUndefined();
  });

  it("listKeys splits the publishable key from the secret rows; createKey returns the secret once", async () => {
    responses = [{ object: "list", data: [
      { id: "key_p", kind: "pk", name: "default", livemode: false, last4: "abcd", redacted: "pk_test_x", publishable_key: "pk_test_x", created: T0, last_used_at: null, revoked_at: null, expires_at: null },
      { id: "key_s", kind: "sk", name: "default", livemode: false, last4: "4f2a", redacted: "sk_test_…4f2a", created: T0, last_used_at: null, revoked_at: null, expires_at: null },
    ] }];
    const list = await api().listKeys("test");
    expect(list.publishable).toBe("pk_test_x");
    expect(list.secret.map((k) => k.id)).toEqual(["key_s"]);
    responses = [{ id: "key_n", kind: "sk", name: "ci", livemode: false, last4: "zzzz", redacted: "sk_test_…zzzz", created: T0, last_used_at: null, revoked_at: null, expires_at: null, secret: "sk_test_full" }];
    const created = await api().createKey("test", "ci", { idempotencyKey: "idem_fixed" });
    expect(created.secret).toBe("sk_test_full");
    expect(calls[1]!.headers["idempotency-key"]).toBe("idem_fixed");
    responses = [{ id: "key_r", kind: "sk", name: "ci", livemode: false, last4: "1111", redacted: "", created: T0, last_used_at: null, revoked_at: null, expires_at: null, secret: "sk_test_new" }];
    await api().rollKey("key_n", { graceMs: 3_600_000 });
    expect(calls[2]).toMatchObject({ url: `${BASE}/v1/api_keys/key_n/roll`, body: { grace: 3600 } });
  });

  it("errors carry the API's message, param and status", async () => {
    responses = [{ __status: 400, error: { type: "invalid_request_error", message: "Invalid url: must use https", param: "url" } }];
    await expect(api().createEndpoint("test", { url: "http://x", events: "*" })).rejects.toMatchObject({ status: 400, code: "invalid_input", param: "url", message: "Invalid url: must use https" });
    responses = [{ __status: 401, error: { type: "authentication_error", message: "Sign in to continue." } }];
    await expect(api().me()).rejects.toMatchObject({ code: "unauthenticated" }); // the gate redirects on this
    responses = [{ __status: 401, error: { type: "authentication_error", message: "This sign-in link is invalid or has expired." } }];
    await expect(api().verifyMagicLink("bad")).rejects.toMatchObject({ code: "link_invalid" });
  });

  it("products map, archive by status, and checkout links return to the dashboard", async () => {
    const w = { id: "prod_1", name: "GPU", description: null, rate_usd_per_second: "0.004", allow_pause: false, active: false, livemode: false, created: T0, active_subscriptions: 3 };
    expect(mapProduct(w)).toMatchObject({ status: "archived", activeSubscriptions: 3, rateUsdPerSecond: "0.004" });
    responses = [{ object: "list", data: [w, { ...w, id: "prod_2", active: true }] }];
    expect((await api().listProducts("test", {})).map((p) => p.id)).toEqual(["prod_2"]);
    responses = [{ object: "list", data: [w, { ...w, id: "prod_2", active: true }] }];
    expect((await api().listProducts("test", { includeArchived: true })).length).toBe(2);
    responses = [{ ...w, active: true }];
    await api().updateProduct("prod_1", { status: "active" });
    expect(calls.at(-1)).toMatchObject({ url: `${BASE}/v1/products/prod_1`, body: { active: true } });
    responses = [{ id: "cs_1", url: "http://localhost:3000/c/cs_1" }];
    const link = await createRealDashboardApi({ baseUrl: BASE, getMode: () => "test", dashboardOrigin: "https://dash.test" }).createCheckoutLink("prod_2");
    expect(link.url).toBe("http://localhost:3000/c/cs_1");
    expect(calls.at(-1)!.body).toEqual({ product: "prod_2", success_url: "https://dash.test/dashboard/subscriptions", cancel_url: "https://dash.test/dashboard/products" });
  });

  it("subscriptions map with product and customer; cancel polls to canceled and builds the receipt", async () => {
    const w = { id: "sub_1", status: "active" as const, product: "prod_1", customer: "cus_1", checkout_session: "cs_1", rate_usd_per_second: "0.004", started_at: T0, paused_at: null, canceled_at: null, ended_reason: null, max_duration_seconds: 3600, max_escrow_usd: "14.4", funded_usd: "14.4", settled_usd: "0", seconds_elapsed: 10, stream_address: "0x1", chain_id: 10143, livemode: false, created: T0, product_name: "GPU", customer_email: "a@x.test" };
    expect(mapSubscription(w)).toMatchObject({ product: { id: "prod_1", name: "GPU" }, customer: { id: "cus_1", email: "a@x.test" }, fundedUsd: "14.4", startedAt: T0 * 1000 });
    const done = { ...w, status: "canceled" as const, ended_reason: "canceled" as const, canceled_at: T0 + 83, settled_usd: "0.332", seconds_elapsed: 83 };
    expect(receiptOf(done)).toEqual({ secondsElapsed: 83, amountSettledUsd: "0.332", refundedUsd: "14.068", canceledAt: (T0 + 83) * 1000 });
    responses = [{ ...w, pending_tx: "0x" + "1".repeat(64) }, w, done];
    const r = await createRealDashboardApi({ baseUrl: BASE, getMode: () => "test" }).cancelSubscription("sub_1");
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/subscriptions/sub_1/cancel` });
    expect(r.subscription.status).toBe("canceled");
    expect(r.receipt.refundedUsd).toBe("14.068");
  });

  it("ledger, notifications and audit rows map to the page vocabulary; balance without a payout address is empty, not an error", async () => {
    expect(mapLedger({ id: "led_1", kind: "refund", amount_usd: "13.52", subscription: "sub_1", customer: "cus_1", customer_email: null, tx_hash: "0xt", log_index: 1, block_timestamp: T0, reversed_by: null, livemode: false })).toMatchObject({ amountUsd: "13.52", blockTime: T0 * 1000, reversedBy: null });
    expect(mapNotification({ id: "ntf_1", kind: "endpoint_failing", summary: "x", target_id: "wh_9", created: T0, read_at: null, emailed_at: null, livemode: false })).toMatchObject({ kind: "endpoint_exhausted", href: "/dashboard/developers/webhooks/wh_9", readAt: null });
    expect(mapAudit({ id: "aud_1", at: T0, actor: "dashboard", action: "api_key.rolled", target: "key_1", ip: null })).toMatchObject({ action: "key.rolled", target: "key_1", ip: "" });
    expect(mapAudit({ id: "aud_2", at: T0, actor: "dashboard", action: "merchant.onboarded", target: null, ip: null })).toBeNull();
    responses = [{ __status: 404, error: { type: "not_found", code: "no_payout_address", message: "Set a payout address first." } }];
    expect((await api().getBalance("test")).payoutAddress).toBeNull();
    responses = [{ object: "list", data: [], unread: 3, other_mode_unread: 1 }];
    expect(await api().unreadCounts()).toEqual({ test: 3, live: 1 });
  });

  it("verifyMagicLink posts the token then reads the profile", async () => {
    responses = [{ id: "mrc_1", object: "merchant" }, profile];
    const m = await api().verifyMagicLink("tok");
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/dashboard/auth/verify`, `${BASE}/v1/dashboard/me`]);
    expect(m.email).toBe("m@acme.test");
  });
});
