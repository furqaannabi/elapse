import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant } from "./helpers";
import { createSession } from "../src/db/sessions";
import { setMailer } from "../src/lib/email";
import { app } from "../src/app";

const ORIGIN = "http://localhost:3000";

async function signIn(): Promise<{ cookie: string; merchantId: string }> {
  const m = await seedMerchant();
  const s = await createSession(m.merchantId, null);
  return { cookie: `elapse_session=${s.token}`, merchantId: m.merchantId };
}
const dash = (cookie: string, method: string, path: string, body?: unknown, mode: "test" | "live" = "test") =>
  api(method, path, { body, headers: { cookie, origin: ORIGIN, "x-elapse-mode": mode } });

beforeEach(async () => {
  await resetDb();
  setMailer(async () => {});
});

describe("FR-API-103 dashboard me", () => {
  it("FR_API_103_me_needs_the_session_cookie_and_hides_nothing_secret", async () => {
    expect((await api("GET", "/v1/dashboard/me")).status).toBe(401);
    const { cookie } = await signIn();
    const r = await dash(cookie, "GET", "/v1/dashboard/me");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      object: "merchant",
      name: null, // not onboarded yet: the dashboard shows first-run
      email: expect.stringContaining("@"),
      payout_address: "0x1111111111111111111111111111111111111111",
      fee_bps: 100,
      branding: { display_name: null, logo_url: null, accent: null, support_url: null },
      notifications: { endpoint_exhausted_email: true, key_expiry_email: true },
      checklist: { key_created: true, product_created: false, endpoint_created: false, first_delivery_succeeded: false },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/sk_|whsec_|hash/);
  });

  it("FR_API_103_first_run_sets_the_name_and_optional_payout_address_and_writes_an_audit_row", async () => {
    const { cookie, merchantId } = await signIn();
    await sql`UPDATE merchants SET payout_address = NULL WHERE id = ${merchantId}`;
    const bad = await dash(cookie, "POST", "/v1/dashboard/me", { name: "", payout_address: "0x12" });
    expect(bad.status).toBe(400);
    const r = await dash(cookie, "POST", "/v1/dashboard/me", { name: "Acme GPU", payout_address: "0xAbC0000000000000000000000000000000000001" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Acme GPU", payout_address: "0xabc0000000000000000000000000000000000001" });
    const again = await dash(cookie, "GET", "/v1/dashboard/me");
    expect(again.body.name).toBe("Acme GPU");
    const rows = await sql`SELECT action FROM audit_log WHERE merchant_id = ${merchantId} ORDER BY at`;
    expect(rows.map((r: any) => r.action)).toContain("merchant.onboarded");
    expect(rows.map((r: any) => r.action)).toContain("payout_address_changed");
  });

  it("FR_API_103_profile_branding_and_notification_switches_update_and_a_mutation_needs_the_dashboard_origin", async () => {
    const { cookie } = await signIn();
    await dash(cookie, "POST", "/v1/dashboard/me", { name: "Acme" });
    const r = await dash(cookie, "POST", "/v1/dashboard/me", { support_email: "help@acme.test", support_url: "https://acme.test/help", branding: { display_name: "Acme Cloud", accent: "#4f46e5" }, notifications: { key_expiry_email: false } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ support_email: "help@acme.test", support_url: "https://acme.test/help", branding: { display_name: "Acme Cloud", accent: "#4f46e5" }, notifications: { endpoint_exhausted_email: true, key_expiry_email: false } });
    const csrf = await api("POST", "/v1/dashboard/me", { body: { name: "X" }, headers: { cookie, origin: "https://evil.example" } });
    expect(csrf.status).toBe(403);
  });

  it("FR_API_103_checklist_follows_the_current_mode", async () => {
    const { cookie } = await signIn();
    await dash(cookie, "POST", "/v1/dashboard/me", { name: "Acme" });
    await api("POST", "/v1/products", { body: { name: "GPU", rate_usd_per_second: "0.004" }, headers: { cookie, origin: ORIGIN, "x-elapse-mode": "test" } });
    expect((await dash(cookie, "GET", "/v1/dashboard/me", undefined, "test")).body.checklist.product_created).toBe(true);
    expect((await dash(cookie, "GET", "/v1/dashboard/me", undefined, "live")).body.checklist.product_created).toBe(false);
  });

  it("CORS: the dashboard origin gets credentials on every /v1 route", async () => {
    const r = await app.request("/v1/products", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-elapse-mode" } });
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(r.headers.get("access-control-allow-credentials")).toBe("true");
    expect(r.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-elapse-mode");
  });
});

describe("local sign-in and delivery filter", () => {
  it("magic_link returns dev_token only when mail is stdout-only", async () => {
    setMailer(null);
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const dev = await api("POST", "/v1/dashboard/auth/magic_link", { body: { email: "dev@example.com" } });
    expect(dev.body.dev_token).toMatch(/.{20,}/);
    setMailer(async () => {});
    const real = await api("POST", "/v1/dashboard/auth/magic_link", { body: { email: "real@example.com" } });
    expect(real.body.dev_token).toBeUndefined();
    if (prev) process.env.RESEND_API_KEY = prev;
  });

  it("deliveries list filters by status", async () => {
    const m = await seedMerchant();
    const ep = await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://merchant.example/hooks", events: ["*"] } });
    await api("POST", `/v1/webhook_endpoints/${ep.body.id}/test`, { key: m.skTest, body: { type: "subscription.created" } });
    expect((await api("GET", `/v1/webhook_endpoints/${ep.body.id}/deliveries?status=queued`, { key: m.skTest })).body.data).toHaveLength(1);
    expect((await api("GET", `/v1/webhook_endpoints/${ep.body.id}/deliveries?status=succeeded`, { key: m.skTest })).body.data).toHaveLength(0);
  });
});
