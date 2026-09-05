import { beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

const good = { name: "GPU hour", rate_usd_per_second: "0.004" };

describe("FR-API-001 bearer auth", () => {
  test("missing key → 401 authentication_error in the FR-API-082 shape", async () => {
    const r = await api("POST", "/v1/products", { body: good });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({
      error: { type: "authentication_error", message: expect.any(String) },
    });
  });

  test("well-formed but unknown key → 401", async () => {
    const r = await api("POST", "/v1/products", { key: "sk_test_" + "x".repeat(24), body: good });
    expect(r.status).toBe(401);
    expect(r.body.error.type).toBe("authentication_error");
  });

  test("malformed key → 401, and the header scheme must be Bearer", async () => {
    expect((await api("POST", "/v1/products", { key: "nonsense", body: good })).status).toBe(401);
    const r = await api("POST", "/v1/products", { headers: { authorization: `Basic ${f.skTest}` }, body: good });
    expect(r.status).toBe(401);
  });

  test("live key cannot read a test product → 404, never 403", async () => {
    const created = await api("POST", "/v1/products", { key: f.skTest, body: good });
    expect(created.status).toBe(200);
    const r = await api("GET", `/v1/products/${created.body.id}`, { key: f.skLive });
    expect(r.status).toBe(404);
    expect(r.body.error.type).toBe("not_found");
    const ok = await api("GET", `/v1/products/${created.body.id}`, { key: f.skTest });
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(created.body.id);
  });

  test("another merchant's key cannot read the product → 404", async () => {
    const created = await api("POST", "/v1/products", { key: f.skTest, body: good });
    const other = await seedMerchant();
    const r = await api("GET", `/v1/products/${created.body.id}`, { key: other.skTest });
    expect(r.status).toBe(404);
  });

  test("a successful call stamps last_used_at on the key", async () => {
    await api("POST", "/v1/products", { key: f.skTest, body: good });
    const [row] = await sql`SELECT last_used_at FROM api_keys WHERE merchant_id = ${f.merchantId} AND kind = 'sk' AND livemode = false`;
    expect(row!.last_used_at).not.toBeNull();
  });
});

describe("FR-API-004 publishable keys", () => {
  test("pk_ on POST /v1/products → 401", async () => {
    const r = await api("POST", "/v1/products", { key: f.pkTest, body: good });
    expect(r.status).toBe(401);
    expect(r.body.error.type).toBe("authentication_error");
  });
});

describe("FR-API-010 products.create", () => {
  test('"0.004" with a 6-decimal token → rate_per_second_wei "4000", currency ausd, active', async () => {
    const r = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, description: "One H100" } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      id: expect.stringMatching(/^prod_[0-9A-Za-z]{14}$/),
      object: "product",
      name: "GPU hour",
      description: "One H100",
      rate_usd_per_second: "0.004",
      rate_per_second_wei: "4000",
      currency: "ausd",
      allow_pause: false,
      active: true,
      livemode: false,
      created: expect.any(Number),
    });
  });

  test("a live key creates a live product", async () => {
    const r = await api("POST", "/v1/products", { key: f.skLive, body: good });
    expect(r.body.livemode).toBe(true);
  });

  test("rate is a decimal string and kept exactly: '1' → 1000000 wei, '0.000001' → 1 wei", async () => {
    const a = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate_usd_per_second: "1" } });
    expect(a.body.rate_per_second_wei).toBe("1000000");
    expect(a.body.rate_usd_per_second).toBe("1");
    const b = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate_usd_per_second: "0.000001" } });
    expect(b.body.rate_per_second_wei).toBe("1");
  });

  test("BR-API-004: a rate not representable in token base units → 400 param=rate_usd_per_second", async () => {
    const r = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate_usd_per_second: "0.0000001" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ type: "invalid_request_error", param: "rate_usd_per_second" });
  });

  test.each([["0"], ["-1"], ["abc"], ["1e-3"], [".5"], ["1."], [0.004], [null]])(
    "rate %p → 400 invalid_request_error",
    async (rate) => {
      const r = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate_usd_per_second: rate } });
      expect(r.status).toBe(400);
      expect(r.body.error.type).toBe("invalid_request_error");
      expect(r.body.error.param).toBe("rate_usd_per_second");
    },
  );

  test("missing name → 400 param=name; unknown fields are rejected", async () => {
    const r = await api("POST", "/v1/products", { key: f.skTest, body: { rate_usd_per_second: "0.004" } });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("name");
    const u = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate: "1" } });
    expect(u.status).toBe(400);
  });

  test("non-JSON body → 400 invalid_request_error", async () => {
    const res = await (await import("../src/app")).app.request("/v1/products", {
      method: "POST",
      headers: { authorization: `Bearer ${f.skTest}`, "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.type).toBe("invalid_request_error");
  });

  test("the row stores NUMERIC, not float, and the wei column matches", async () => {
    const r = await api("POST", "/v1/products", { key: f.skTest, body: { ...good, rate_usd_per_second: "0.1" } });
    const [row] = await sql`SELECT rate_usd_per_second::text AS rate, rate_per_second_wei::text AS wei FROM products WHERE id = ${r.body.id}`;
    expect(row!.rate).toMatch(/^0\.1(0+)?$/);
    expect(row!.wei).toBe("100000");
  });
});

describe("FR-API-082 unknown route", () => {
  test("→ 404 not_found in the error shape", async () => {
    const r = await api("GET", "/v1/nothing", { key: f.skTest });
    expect(r.status).toBe(404);
    expect(r.body.error.type).toBe("not_found");
  });
});
