import { beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
let prod: any;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
  prod = (await api("POST", "/v1/products", { key: f.skTest, body: { name: "GPU hour", rate_usd_per_second: "0.004", allow_pause: true } })).body;
});

const good = () => ({ product: prod.id, success_url: "https://acme.test/ok", cancel_url: "https://acme.test/no" });

describe("FR-API-030 checkout.sessions.create", () => {
  test("returns cs_ id, hosted url, open, +24h expiry, product, merchant branding", async () => {
    const before = Math.floor(Date.now() / 1000);
    const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      id: expect.stringMatching(/^cs_[0-9A-Za-z]{14}$/),
      object: "checkout.session",
      status: "open",
      url: `http://localhost:3000/c/${r.body.id}`,
      livemode: false,
      created: expect.any(Number),
      expires_at: expect.any(Number),
      success_url: "https://acme.test/ok",
      cancel_url: "https://acme.test/no",
      product: expect.objectContaining({ id: prod.id, object: "product", rate_usd_per_second: "0.004" }),
      merchant: { name: "Acme GPU", logo_url: null, accent: null, support_url: null },
      customer: null,
      subscription: null,
      max_duration_seconds: null,
      max_escrow_usd: null,
    });
    expect(r.body.expires_at - before).toBeGreaterThanOrEqual(24 * 3600 - 2);
    expect(r.body.expires_at - before).toBeLessThanOrEqual(24 * 3600 + 2);
  });

  test("merchant passes max_duration_seconds → cap fixed and max_escrow_usd exact: 0.004 × 3600 = 14.4", async () => {
    const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), max_duration_seconds: 3600 } });
    expect(r.status).toBe(200);
    expect(r.body.max_duration_seconds).toBe(3600);
    expect(r.body.max_escrow_usd).toBe("14.4");
  });

  test("max_escrow_usd never goes through a float: 0.000001 × 2592000 = 2.592, 0.1 × 3 = 0.3", async () => {
    const tiny = (await api("POST", "/v1/products", { key: f.skTest, body: { name: "tiny", rate_usd_per_second: "0.000001" } })).body;
    const a = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), product: tiny.id, max_duration_seconds: 2592000 } });
    expect(a.body.max_escrow_usd).toBe("2.592");
    const tenth = (await api("POST", "/v1/products", { key: f.skTest, body: { name: "tenth", rate_usd_per_second: "0.1" } })).body;
    const b = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), product: tenth.id, max_duration_seconds: 60 } });
    expect(b.body.max_escrow_usd).toBe("6");
  });

  test.each([[59], [2592001], [0], [-5], [3600.5], ["3600"]])("max_duration_seconds %p → 400", async (v) => {
    const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), max_duration_seconds: v } });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("max_duration_seconds");
  });

  test("archived product → 400 param=product; unknown or other-mode product → 400 param=product", async () => {
    await api("POST", `/v1/products/${prod.id}`, { key: f.skTest, body: { active: false } });
    const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ type: "invalid_request_error", param: "product" });
    const live = await api("POST", "/v1/checkout/sessions", { key: f.skLive, body: good() });
    expect(live.status).toBe(400);
    expect(live.body.error.param).toBe("product");
    const nope = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), product: "prod_nope" } });
    expect(nope.status).toBe(400);
  });

  test("urls must be absolute http(s); live mode requires https", async () => {
    for (const bad of ["acme.test/ok", "javascript:alert(1)", "ftp://x", ""]) {
      const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), success_url: bad } });
      expect(r.status).toBe(400);
      expect(r.body.error.param).toBe("success_url");
    }
    const http = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), cancel_url: "http://localhost:5173/no" } });
    expect(http.status).toBe(200);
    const liveProd = (await api("POST", "/v1/products", { key: f.skLive, body: { name: "live", rate_usd_per_second: "0.004" } })).body;
    const liveHttp = await api("POST", "/v1/checkout/sessions", { key: f.skLive, body: { ...good(), product: liveProd.id, cancel_url: "http://acme.test/no" } });
    expect(liveHttp.status).toBe(400);
    expect(liveHttp.body.error.param).toBe("cancel_url");
  });

  test("pk_ cannot create a session (FR-API-004)", async () => {
    const r = await api("POST", "/v1/checkout/sessions", { key: f.pkTest, body: good() });
    expect(r.status).toBe(401);
  });

  test("merchant branding flows into the session (FR-API-103 fields)", async () => {
    await sql`UPDATE merchants SET branding = ${{ display_name: "Acme Cloud", logo_url: "https://cdn.acme.test/logo.png", accent: "#0033cc", support_url: "https://acme.test/help" }} WHERE id = ${f.merchantId}`;
    const r = await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() });
    expect(r.body.merchant).toEqual({ name: "Acme Cloud", logo_url: "https://cdn.acme.test/logo.png", accent: "#0033cc", support_url: "https://acme.test/help" });
  });
});

describe("FR-API-031 retrieve: two projections", () => {
  test("sk_ gets the full object; pk_ gets the public projection only", async () => {
    const cs = (await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: { ...good(), max_duration_seconds: 3600 } })).body;
    const full = await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: f.skTest });
    expect(full.status).toBe(200);
    expect(full.body).toEqual(cs);

    const pub = await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: f.pkTest });
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual({
      id: cs.id,
      object: "checkout.session",
      status: "open",
      expires_at: cs.expires_at,
      merchant: {
        name: "Acme GPU",
        logo_url: null,
        accent: null,
        support_url: null,
        success_url: "https://acme.test/ok",
        cancel_url: "https://acme.test/no",
      },
      product: { id: prod.id, name: "GPU hour", rate_usd_per_second: "0.004", allow_pause: true, active: true },
      customer: null,
      subscription: null,
      max_duration_seconds: 3600,
      max_escrow_usd: "14.4",
    });
    // The public projection must never carry these.
    expect(JSON.stringify(pub.body)).not.toMatch(/rate_per_second_wei|livemode|"created"|"url"|merchant_id|secret|sk_|whsec_/);
  });

  test("pk_ of another merchant, or the other mode, → 404", async () => {
    const cs = (await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() })).body;
    const other = await seedMerchant();
    expect((await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: other.pkTest })).status).toBe(404);
    expect((await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: f.skLive })).status).toBe(404);
    expect((await api("GET", `/v1/checkout/sessions/cs_nope`, { key: f.pkTest })).status).toBe(404);
  });

  test("no key → 401 (the page must send its publishable key)", async () => {
    const cs = (await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() })).body;
    expect((await api("GET", `/v1/checkout/sessions/${cs.id}`)).status).toBe(401);
  });
});

describe("FR-API-033 session states", () => {
  test("a session past expires_at reads as expired", async () => {
    const cs = (await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() })).body;
    await sql`UPDATE checkout_sessions SET expires_at = now() - interval '1 second' WHERE id = ${cs.id}`;
    const r = await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: f.pkTest });
    expect(r.body.status).toBe("expired");
  });

  test("a product archived after the session was created still reads with active:false so the page can show the archived state", async () => {
    const cs = (await api("POST", "/v1/checkout/sessions", { key: f.skTest, body: good() })).body;
    await api("POST", `/v1/products/${prod.id}`, { key: f.skTest, body: { active: false } });
    const r = await api("GET", `/v1/checkout/sessions/${cs.id}`, { key: f.pkTest });
    expect(r.body.product.active).toBe(false);
  });
});
