import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealDashboardApi, keyStatus, mapDelivery, mapEndpoint, mapEvent, mapKey, mapMerchant, NotWired } from "./real-api";

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
    await expect(api().listProducts("test", {})).rejects.toBeInstanceOf(NotWired);
    responses = [{ __status: 401, error: { type: "authentication_error", message: "Sign in to continue." } }];
    await expect(api().me()).rejects.toMatchObject({ code: "unauthenticated" }); // the gate redirects on this
    responses = [{ __status: 401, error: { type: "authentication_error", message: "This sign-in link is invalid or has expired." } }];
    await expect(api().verifyMagicLink("bad")).rejects.toMatchObject({ code: "link_invalid" });
  });

  it("verifyMagicLink posts the token then reads the profile", async () => {
    responses = [{ id: "mrc_1", object: "merchant" }, profile];
    const m = await api().verifyMagicLink("tok");
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/dashboard/auth/verify`, `${BASE}/v1/dashboard/me`]);
    expect(m.email).toBe("m@acme.test");
  });
});
