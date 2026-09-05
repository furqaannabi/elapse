import { beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

async function create(key: string, name: string, rate = "0.004") {
  const r = await api("POST", "/v1/products", { key, body: { name, rate_usd_per_second: rate } });
  expect(r.status).toBe(200);
  return r.body;
}

describe("FR-API-080 lists", () => {
  test("shape {object:'list', data, has_more, url}, default limit 10, newest first", async () => {
    for (let i = 0; i < 12; i++) await create(f.skTest, `p${i}`);
    const r = await api("GET", "/v1/products", { key: f.skTest });
    expect(r.status).toBe(200);
    expect(r.body.object).toBe("list");
    expect(r.body.url).toBe("/v1/products");
    expect(r.body.has_more).toBe(true);
    expect(r.body.data).toHaveLength(10);
    expect(r.body.data[0].name).toBe("p11");
    expect(r.body.data[9].name).toBe("p2");
  });

  test("cursor across 25 rows: three pages, no duplicates, no gaps, has_more false at the end", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await create(f.skTest, `p${i}`)).id);
    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    for (;;) {
      const q = after ? `?limit=10&starting_after=${after}` : "?limit=10";
      const r = await api("GET", `/v1/products${q}`, { key: f.skTest });
      expect(r.status).toBe(200);
      pages++;
      seen.push(...r.body.data.map((p: any) => p.id));
      if (!r.body.has_more) break;
      after = r.body.data.at(-1).id;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...ids].reverse());
  });

  test("an exact multiple of limit reports has_more false only on the last page", async () => {
    for (let i = 0; i < 10; i++) await create(f.skTest, `p${i}`);
    const r = await api("GET", "/v1/products?limit=10", { key: f.skTest });
    expect(r.body.has_more).toBe(false);
    expect(r.body.data).toHaveLength(10);
  });

  test.each([["0"], ["101"], ["abc"], ["1.5"], ["-1"]])("limit=%s → 400 param=limit", async (limit) => {
    const r = await api("GET", `/v1/products?limit=${limit}`, { key: f.skTest });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ type: "invalid_request_error", param: "limit" });
  });

  test("starting_after that does not exist in this mode → 400 param=starting_after", async () => {
    const live = await create(f.skLive, "live one");
    const r = await api("GET", `/v1/products?starting_after=${live.id}`, { key: f.skTest });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("starting_after");
    const r2 = await api("GET", "/v1/products?starting_after=prod_nope", { key: f.skTest });
    expect(r2.status).toBe(400);
  });

  test("lists are scoped by mode and merchant", async () => {
    await create(f.skTest, "t1");
    await create(f.skLive, "l1");
    const other = await seedMerchant();
    await create(other.skTest, "o1");
    const t = await api("GET", "/v1/products", { key: f.skTest });
    expect(t.body.data.map((p: any) => p.name)).toEqual(["t1"]);
    const l = await api("GET", "/v1/products", { key: f.skLive });
    expect(l.body.data.map((p: any) => p.name)).toEqual(["l1"]);
  });

  test("archived products are still listed (active:false), like Stripe", async () => {
    const p = await create(f.skTest, "a");
    await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: { active: false } });
    const r = await api("GET", "/v1/products", { key: f.skTest });
    expect(r.body.data[0]).toMatchObject({ id: p.id, active: false });
  });
});

describe("FR-API-011 products.update", () => {
  test("name, description, allow_pause and active are updatable; the response is the full object", async () => {
    const p = await create(f.skTest, "old");
    const r = await api("POST", `/v1/products/${p.id}`, {
      key: f.skTest,
      body: { name: "new", description: "desc", allow_pause: true, active: false },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: p.id,
      object: "product",
      name: "new",
      description: "desc",
      allow_pause: true,
      active: false,
      rate_usd_per_second: "0.004",
      rate_per_second_wei: "4000",
    });
    const [row] = await sql`SELECT updated_at > created_at AS bumped FROM products WHERE id = ${p.id}`;
    expect(row!.bumped).toBe(true);
  });

  test("a partial update leaves other fields alone; description can be cleared with null", async () => {
    const p = await create(f.skTest, "keep");
    await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: { description: "x" } });
    const r = await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: { description: null } });
    expect(r.body).toMatchObject({ name: "keep", description: null, active: true });
  });

  test("rate is immutable: 400 param=rate_usd_per_second, even when unchanged", async () => {
    const p = await create(f.skTest, "fixed");
    const r = await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: { rate_usd_per_second: "0.004" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ type: "invalid_request_error", param: "rate_usd_per_second" });
    const same = await api("GET", `/v1/products/${p.id}`, { key: f.skTest });
    expect(same.body.rate_usd_per_second).toBe("0.004");
  });

  test("empty body → 400; unknown field → 400", async () => {
    const p = await create(f.skTest, "e");
    expect((await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: {} })).status).toBe(400);
    expect((await api("POST", `/v1/products/${p.id}`, { key: f.skTest, body: { colour: "red" } })).status).toBe(400);
  });

  test("other mode or other merchant → 404", async () => {
    const p = await create(f.skTest, "mine");
    expect((await api("POST", `/v1/products/${p.id}`, { key: f.skLive, body: { name: "x" } })).status).toBe(404);
    const other = await seedMerchant();
    expect((await api("POST", `/v1/products/${p.id}`, { key: other.skTest, body: { name: "x" } })).status).toBe(404);
    expect((await api("GET", `/v1/products/${p.id}`, { key: f.skTest })).body.name).toBe("mine");
  });
});
