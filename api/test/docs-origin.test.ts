/**
 * FR-API-086: the docs reference's try-it panel calls the API from the browser
 * with a test key. Only that origin gains CORS on the public routes, and a live
 * key from it is refused before anything else runs.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

const DOCS = "https://docs.test";
let f: Fixture;
beforeAll(async () => {
  await resetDb();
  f = await seedMerchant();
});

describe("FR-API-086 docs origin", () => {
  it("answers the preflight for the docs origin with Authorization allowed", async () => {
    const res = await app.request("/v1/products", { method: "OPTIONS", headers: { origin: DOCS, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(DOCS);
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  it("lets a test key list products from the docs origin", async () => {
    const r = await api("GET", "/v1/products", { key: f.skTest, headers: { origin: DOCS } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(DOCS);
  });

  it("refuses a live key from the docs origin with a named code", async () => {
    const r = await api("GET", "/v1/products", { key: f.skLive, headers: { origin: DOCS } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { type: "authentication_error", code: "live_key_in_browser", message: "Live keys cannot be used from a browser." } });
    // The panel can only show the message if the refusal itself passes CORS.
    expect(r.headers.get("access-control-allow-origin")).toBe(DOCS);
  });

  it("leaves a live key without an Origin, and any other origin, as before", async () => {
    expect((await api("GET", "/v1/products", { key: f.skLive })).status).toBe(200);
    const other = await api("GET", "/v1/products", { key: f.skTest, headers: { origin: "https://evil.test" } });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
