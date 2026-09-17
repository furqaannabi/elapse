import { describe, it, expect, beforeEach } from "bun:test";
import { app } from "../src/app";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

/**
 * FR-API-140(c) (signed 2026-09-17): `@elapse/react` reads the public session from the merchant's own
 * origin, so that one read-only route answers any origin. Nothing else does: every mutation happens
 * in the Elapse popup, on Elapse's origin.
 */

const SHOP = "https://shop.test";
let m: Fixture;
let sessionId: string;

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: `${SHOP}/ok`, cancel_url: `${SHOP}/no` } });
  sessionId = s.body.id;
});

const preflight = (path: string, method: string, headers = "authorization") =>
  app.request(path, { method: "OPTIONS", headers: { origin: SHOP, "access-control-request-method": method, "access-control-request-headers": headers } });

describe("FR-API-140(c) public session reads from any origin", () => {
  it("FR_API_140_the_public_session_read_answers_a_merchant_origin_without_credentials", async () => {
    const pre = await preflight(`/v1/checkout/sessions/${sessionId}`, "GET");
    expect(pre.headers.get("access-control-allow-origin")).toBe(SHOP);
    expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
    expect(pre.headers.get("access-control-allow-methods")).not.toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();

    const read = await app.request(`/v1/checkout/sessions/${sessionId}`, { headers: { origin: SHOP, authorization: `Bearer ${m.pkTest}` } });
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe(SHOP);
    expect(((await read.json()) as { id: string }).id).toBe(sessionId);
  });

  it("FR_API_140_every_mutation_stays_closed_to_a_merchant_origin", async () => {
    for (const [path, method] of [
      [`/v1/checkout/sessions/${sessionId}/prepare`, "POST"],
      [`/v1/checkout/sessions/${sessionId}/start`, "POST"],
      [`/v1/checkout/sessions/${sessionId}/cancel`, "POST"],
      ["/v1/checkout/sessions", "POST"],
      ["/v1/account/subscriptions", "GET"],
    ] as const) {
      const pre = await preflight(path, method, "content-type, authorization, x-privy-token");
      expect({ path, allow: pre.headers.get("access-control-allow-origin") }).toEqual({ path, allow: null });
    }
  });

  it("FR_API_140_the_read_still_needs_a_publishable_key", async () => {
    const r = await app.request(`/v1/checkout/sessions/${sessionId}`, { headers: { origin: SHOP } });
    expect(r.status).toBe(401);
  });
});
