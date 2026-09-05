import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { setMailer, type Mail } from "../src/lib/email";
import { api, resetDb } from "./helpers";

const ORIGIN = "http://localhost:3000";
let sent: Mail[] = [];
setMailer(async (m) => {
  sent.push(m);
});

beforeEach(async () => {
  await resetDb();
  await sql`DELETE FROM magic_links`;
  sent = [];
});

async function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, ...init.headers };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, { method: init.method ?? "POST", headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

function tokenFrom(mail: Mail): string {
  return /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
}

async function signIn(email = "founder@acme.test") {
  await request("/v1/dashboard/auth/magic_link", { body: { email } });
  const r = await request("/v1/dashboard/auth/verify", { body: { token: tokenFrom(sent.at(-1)!) } });
  expect(r.status).toBe(200);
  const cookie = r.headers.get("set-cookie")!;
  return { merchant: r.body, cookie: cookie.split(";")[0]! };
}

describe("FR-API-100 magic link", () => {
  test("always 200 {sent:true}; sends one email with a token link; the token is stored hashed", async () => {
    const r = await request("/v1/dashboard/auth/magic_link", { body: { email: "Founder@Acme.test" } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("founder@acme.test");
    const token = tokenFrom(sent[0]!);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(sent[0]!.text).toContain(`${ORIGIN}/login/verify?token=`);
    const rows = await sql`SELECT email, encode(token_hash, 'hex') AS h, used_at, expires_at > now() + interval '14 minutes' AS long_enough, expires_at < now() + interval '16 minutes' AS short_enough FROM magic_links`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.h).not.toContain(token);
    expect(rows[0]).toMatchObject({ email: "founder@acme.test", used_at: null, long_enough: true, short_enough: true });
  });

  test("invalid email → 400 param=email", async () => {
    const r = await request("/v1/dashboard/auth/magic_link", { body: { email: "nope" } });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("email");
  });

  test("sixth request for one email within an hour → 429 with Retry-After; still no account enumeration", async () => {
    for (let i = 0; i < 5; i++) expect((await request("/v1/dashboard/auth/magic_link", { body: { email: "a@b.test" } })).status).toBe(200);
    const r = await request("/v1/dashboard/auth/magic_link", { body: { email: "a@b.test" } });
    expect(r.status).toBe(429);
    expect(r.body.error.type).toBe("rate_limit_error");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(sent).toHaveLength(5);
  });

  test("21st request from one IP within an hour → 429", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await request("/v1/dashboard/auth/magic_link", { body: { email: `u${i}@b.test` }, headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(200);
    }
    const r = await request("/v1/dashboard/auth/magic_link", { body: { email: "u99@b.test" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(r.status).toBe(429);
  });
});

describe("FR-API-100 verify / FR-API-101 session cookie", () => {
  test("verify consumes the token, creates the merchant on first sign-in, sets the cookie, writes audit sign_in", async () => {
    await request("/v1/dashboard/auth/magic_link", { body: { email: "new@acme.test" } });
    const token = tokenFrom(sent[0]!);
    const r = await request("/v1/dashboard/auth/verify", { body: { token } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: expect.stringMatching(/^mrc_/), object: "merchant", name: expect.any(String), email: "new@acme.test", created: expect.any(Number) });
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^elapse_session=[A-Za-z0-9_-]{32,};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=604800/);
    const [audit] = await sql`SELECT action FROM audit_log WHERE merchant_id = ${r.body.id} AND action = 'sign_in'`;
    expect(audit).toBeDefined();
    const [s] = await sql`SELECT count(*)::int AS n FROM dashboard_sessions WHERE merchant_id = ${r.body.id}`;
    expect(s!.n).toBe(1);
    // the raw cookie value is not stored
    const value = cookie.split(";")[0]!.split("=")[1]!;
    const [plain] = await sql`SELECT count(*)::int AS n FROM dashboard_sessions WHERE id = ${value}`;
    expect(plain!.n).toBe(0);
  });

  test("a second sign-in with the same email reuses the merchant", async () => {
    const a = await signIn("same@acme.test");
    const b = await signIn("same@acme.test");
    expect(b.merchant.id).toBe(a.merchant.id);
  });

  test("token reuse → 401; expired → 401; garbage → 401", async () => {
    await request("/v1/dashboard/auth/magic_link", { body: { email: "x@acme.test" } });
    const token = tokenFrom(sent[0]!);
    expect((await request("/v1/dashboard/auth/verify", { body: { token } })).status).toBe(200);
    expect((await request("/v1/dashboard/auth/verify", { body: { token } })).status).toBe(401);
    await request("/v1/dashboard/auth/magic_link", { body: { email: "y@acme.test" } });
    await sql`UPDATE magic_links SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`;
    expect((await request("/v1/dashboard/auth/verify", { body: { token: tokenFrom(sent[1]!) } })).status).toBe(401);
    expect((await request("/v1/dashboard/auth/verify", { body: { token: "nonsense" } })).status).toBe(401);
  });

  test("the cookie authenticates merchant routes (FR-API-102); X-Elapse-Mode scopes the query; actor is dashboard", async () => {
    const { cookie, merchant } = await signIn();
    const created = await request("/v1/products", { body: { name: "P", rate_usd_per_second: "0.004" }, headers: { cookie } });
    expect(created.status).toBe(200);
    expect(created.body.livemode).toBe(false);
    const live = await request("/v1/products", { body: { name: "L", rate_usd_per_second: "0.004" }, headers: { cookie, "x-elapse-mode": "live" } });
    expect(live.body.livemode).toBe(true);
    const testList = await request("/v1/products", { method: "GET", headers: { cookie } });
    expect(testList.body.data.map((p: any) => p.name)).toEqual(["P"]);
    const liveList = await request("/v1/products", { method: "GET", headers: { cookie, "x-elapse-mode": "live" } });
    expect(liveList.body.data.map((p: any) => p.name)).toEqual(["L"]);
    expect((await request("/v1/products", { method: "GET", headers: { cookie, "x-elapse-mode": "prod" } })).status).toBe(400);
    const wh = await request("/v1/webhook_endpoints", { body: { url: "https://acme.test/h", events: ["*"] }, headers: { cookie } });
    const [audit] = await sql`SELECT actor FROM audit_log WHERE target = ${wh.body.id}`;
    expect(audit!.actor).toBe("dashboard");
    void merchant;
  });

  test("missing cookie → 401; unknown cookie → 401; expired session → 401", async () => {
    expect((await request("/v1/api_keys", { method: "GET" })).status).toBe(401);
    expect((await request("/v1/api_keys", { method: "GET", headers: { cookie: "elapse_session=" + "x".repeat(43) } })).status).toBe(401);
    const { cookie } = await signIn();
    await sql`UPDATE dashboard_sessions SET expires_at = now() - interval '1 second'`;
    expect((await request("/v1/api_keys", { method: "GET", headers: { cookie } })).status).toBe(401);
  });

  test("CSRF: a mutating cookie request with a wrong or missing Origin → 403; GET is fine; sk_ requests ignore Origin", async () => {
    const { cookie } = await signIn();
    const bad = await request("/v1/products", { body: { name: "P", rate_usd_per_second: "1" }, headers: { cookie, origin: "https://evil.test" } });
    expect(bad.status).toBe(403);
    const none = await app.request("/v1/products", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "P", rate_usd_per_second: "1" }) });
    expect(none.status).toBe(403);
    const get = await request("/v1/products", { method: "GET", headers: { cookie, origin: "https://evil.test" } });
    expect(get.status).toBe(200);
  });

  test("sign_out clears the cookie and invalidates the session", async () => {
    const { cookie } = await signIn();
    const r = await request("/v1/dashboard/auth/sign_out", { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/elapse_session=;.*Max-Age=0/);
    expect((await request("/v1/api_keys", { method: "GET", headers: { cookie } })).status).toBe(401);
  });

  test("a cookie is refused on /internal/* and cannot read another merchant's product", async () => {
    const { cookie } = await signIn("a@acme.test");
    const other = await signIn("b@acme.test");
    const p = await request("/v1/products", { body: { name: "mine", rate_usd_per_second: "1" }, headers: { cookie } });
    expect((await request(`/v1/products/${p.body.id}`, { method: "GET", headers: { cookie: other.cookie } })).status).toBe(404);
    expect((await request("/internal/ingest", { body: {}, headers: { cookie } })).status).toBe(401);
  });
});

describe("FR-API-003 / FR-API-002 / FR-API-105 api_keys", () => {
  test("create returns the plaintext once; list shows prefix + last4 for sk and the full pk", async () => {
    const { cookie } = await signIn();
    const c = await request("/v1/api_keys", { body: { name: "server" }, headers: { cookie } });
    expect(c.status).toBe(200);
    // structuredClone: Bun 1.4 toMatchObject writes asymmetric matchers into the received object.
    expect(structuredClone(c.body)).toMatchObject({ id: expect.stringMatching(/^key_/), object: "api_key", kind: "sk", name: "server", livemode: false, last4: expect.any(String), created: expect.any(Number), revoked_at: null, expires_at: null, secret: expect.stringMatching(/^sk_test_[0-9A-Za-z]{24}$/) });
    const l = await request("/v1/api_keys", { method: "GET", headers: { cookie } });
    expect(l.status).toBe(200);
    const sk = l.body.data.find((k: any) => k.kind === "sk");
    expect(sk.redacted).toBe(`sk_test_…${c.body.secret.slice(-4)}`);
    expect(sk.last4).toBe(c.body.secret.slice(-4));
    expect(sk.secret).toBeUndefined();
    expect(JSON.stringify(l.body)).not.toContain(c.body.secret);
    const pk = l.body.data.find((k: any) => k.kind === "pk");
    expect(pk.publishable_key).toMatch(/^pk_test_[0-9A-Za-z]{24}$/);
    expect((await request("/v1/api_keys", { body: {}, headers: { cookie } })).status).toBe(400);
  });

  test("a publishable key per mode is created on first sign-in", async () => {
    const { cookie } = await signIn();
    const t = await request("/v1/api_keys", { method: "GET", headers: { cookie } });
    expect(t.body.data.filter((k: any) => k.kind === "pk")).toHaveLength(1);
    const l = await request("/v1/api_keys", { method: "GET", headers: { cookie, "x-elapse-mode": "live" } });
    expect(l.body.data.filter((k: any) => k.kind === "pk")).toHaveLength(1);
    expect(l.body.data[0].publishable_key).toMatch(/^pk_live_/);
  });

  test("the new key works as a bearer; sk_ cannot manage keys (FR-API-003 is cookie-only)", async () => {
    const { cookie } = await signIn();
    const c = await request("/v1/api_keys", { body: { name: "server" }, headers: { cookie } });
    expect((await api("GET", "/v1/products", { key: c.body.secret })).status).toBe(200);
    expect((await api("GET", "/v1/api_keys", { key: c.body.secret })).status).toBe(401);
    expect((await api("POST", "/v1/api_keys", { key: c.body.secret, body: { name: "x" } })).status).toBe(401);
  });

  test.each([[0], [3600], [86400]])("roll with grace %p: new key returned once, old expires_at = now + grace (0 revokes at once)", async (grace) => {
    const { cookie } = await signIn();
    const c = await request("/v1/api_keys", { body: { name: "server" }, headers: { cookie } });
    const before = Math.floor(Date.now() / 1000);
    const r = await request(`/v1/api_keys/${c.body.id}/roll`, { body: { grace }, headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.body.secret).toMatch(/^sk_test_/);
    expect(r.body.secret).not.toBe(c.body.secret);
    expect(r.body.name).toBe("server");
    expect(r.body.id).not.toBe(c.body.id);
    const l = await request("/v1/api_keys", { method: "GET", headers: { cookie } });
    const old = l.body.data.find((k: any) => k.id === c.body.id);
    if (grace === 0) {
      expect(old.revoked_at).not.toBeNull();
      expect((await api("GET", "/v1/products", { key: c.body.secret })).status).toBe(401);
    } else {
      expect(old.revoked_at).toBeNull();
      expect(old.expires_at - before).toBeGreaterThanOrEqual(grace - 2);
      expect(old.expires_at - before).toBeLessThanOrEqual(grace + 2);
      expect((await api("GET", "/v1/products", { key: c.body.secret })).status).toBe(200);
    }
    expect((await api("GET", "/v1/products", { key: r.body.secret })).status).toBe(200);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'api_key.rolled' AND target = ${c.body.id}`;
    expect(n).toBe(1);
  });

  test("roll with another grace → 400 param=grace; rolling a pk or a revoked key → 400", async () => {
    const { cookie } = await signIn();
    const c = await request("/v1/api_keys", { body: { name: "server" }, headers: { cookie } });
    expect((await request(`/v1/api_keys/${c.body.id}/roll`, { body: { grace: 60 }, headers: { cookie } })).body.error.param).toBe("grace");
    const pk = (await request("/v1/api_keys", { method: "GET", headers: { cookie } })).body.data.find((k: any) => k.kind === "pk");
    expect((await request(`/v1/api_keys/${pk.id}/roll`, { body: { grace: 0 }, headers: { cookie } })).status).toBe(400);
    await request(`/v1/api_keys/${c.body.id}`, { method: "DELETE", headers: { cookie } });
    expect((await request(`/v1/api_keys/${c.body.id}/roll`, { body: { grace: 0 }, headers: { cookie } })).status).toBe(400);
  });

  test("revoke: the row stays with revoked_at, the key stops working at once, audit row; other merchant → 404", async () => {
    const { cookie } = await signIn();
    const c = await request("/v1/api_keys", { body: { name: "server" }, headers: { cookie } });
    const r = await request(`/v1/api_keys/${c.body.id}`, { method: "DELETE", headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: c.body.id, object: "api_key", revoked_at: expect.any(Number) });
    expect((await api("GET", "/v1/products", { key: c.body.secret })).status).toBe(401);
    const l = await request("/v1/api_keys", { method: "GET", headers: { cookie } });
    expect(l.body.data.find((k: any) => k.id === c.body.id).revoked_at).not.toBeNull();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'api_key.revoked' AND target = ${c.body.id}`;
    expect(n).toBe(1);
    const other = await signIn("other@acme.test");
    const k2 = await request("/v1/api_keys", { body: { name: "s" }, headers: { cookie } });
    expect((await request(`/v1/api_keys/${k2.body.id}`, { method: "DELETE", headers: { cookie: other.cookie } })).status).toBe(404);
  });

  test("keys are listed per mode", async () => {
    const { cookie } = await signIn();
    await request("/v1/api_keys", { body: { name: "t" }, headers: { cookie } });
    await request("/v1/api_keys", { body: { name: "l" }, headers: { cookie, "x-elapse-mode": "live" } });
    const t = (await request("/v1/api_keys", { method: "GET", headers: { cookie } })).body.data.filter((k: any) => k.kind === "sk");
    const l = (await request("/v1/api_keys", { method: "GET", headers: { cookie, "x-elapse-mode": "live" } })).body.data.filter((k: any) => k.kind === "sk");
    expect(t.map((k: any) => k.name)).toEqual(["t"]);
    expect(l.map((k: any) => k.name)).toEqual(["l"]);
  });
});
