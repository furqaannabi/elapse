/**
 * FR-API-153 / BR-API-010: what a demo session may write (ADR 2026-10-02 demo account). Deny by
 * default: a mutating route not named here is refused to the demo, and this test fails until a new
 * route is classified on purpose.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { api, resetDb } from "./helpers";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { ensureDemoMerchant } from "../src/db/demo";
import { ensureExampleCredentials, ensureSeedEndpoints, ensureSeedProducts } from "../src/services/demo-catalog";
import { createSession } from "../src/db/sessions";
import { demoMayWrite } from "../src/middleware/demo-allowlist";
import { setFaucetClient } from "../src/chain/faucet";
import { fakeFaucet } from "./fake-faucet";

/** What the demo may write, in test mode only. Everything else that mutates is refused. */
const ALLOWED = new Set([
  "POST /v1/products",
  "POST /v1/products/:id",
  "POST /v1/checkout/sessions",
  "POST /v1/webhook_endpoints",
  "POST /v1/webhook_endpoints/:id",
  "DELETE /v1/webhook_endpoints/:id",
  "POST /v1/webhook_endpoints/:id/roll_secret",
  "POST /v1/webhook_endpoints/:id/test",
  "POST /v1/events/:id/resend",
  "POST /v1/deliveries/:id/resend",
  "POST /v1/dashboard/notifications/read_all",
  "POST /v1/dashboard/faucet",
  "POST /v1/api_keys",
  "POST /v1/api_keys/:id/roll",
  "DELETE /v1/api_keys/:id",
]);

/** Refused to the demo on purpose. A route in neither set fails the walk below. */
const DENIED = new Set([
  "POST /v1/checkout/sessions/:id/prepare", // subscriber routes: never a dashboard session's to call
  "POST /v1/checkout/sessions/:id/start",
  "POST /v1/checkout/sessions/:id/cancel/prepare",
  "POST /v1/checkout/sessions/:id/cancel",
  "POST /v1/checkout/sessions/:id/faucet",
  "POST /v1/checkout/sessions/:id/again",
  "POST /v1/account/subscriptions/:id/cancel/prepare",
  "POST /v1/account/subscriptions/:id/cancel",
  "POST /v1/account/subscriptions/:id/receipt/email",
  "POST /v1/subscriptions/:id/start", // not on the list Furqaan accepted
  "POST /v1/subscriptions/:id/pause",
  "POST /v1/subscriptions/:id/resume",
  "POST /v1/subscriptions/:id/cancel",
  "POST /v1/cli/sessions",
  "POST /v1/cli/sessions/:id/deliveries/:delivery/ack",
  "POST /v1/dashboard/me", // would rename the merchant every checkout shows
  "POST /v1/dashboard/branding/logo", // an arbitrary public image
  "DELETE /v1/dashboard/branding/logo",
  "POST /v1/dashboard/payout_address",
  "POST /v1/dashboard/test_data/delete", // would wipe the demo for everyone
  "POST /internal/ingest",
]);

/** Routes no session ever passes through the auth middleware on: sign-in, sign-out, and the demo's webhook sink. */
const NOT_AUTHED = new Set(["POST /v1/dashboard/auth/magic_link", "POST /v1/dashboard/auth/verify", "POST /v1/dashboard/auth/sign_out", "POST /v1/dashboard/auth/demo", "POST /v1/demo/webhooks"]);

const concrete = (pattern: string) => pattern.replace(/:[a-z_]+/g, "x_1");

describe("FR-API-153 the demo allowlist", () => {
  it("FR_API_153_every_mutating_route_is_classified_and_only_the_allowlist_passes_in_test_mode", () => {
    const seen = new Set<string>();
    for (const r of app.routes) {
      if (["GET", "HEAD", "OPTIONS", "ALL"].includes(r.method)) continue;
      const key = `${r.method} ${r.path}`;
      if (seen.has(key) || NOT_AUTHED.has(key)) continue;
      seen.add(key);
      expect({ route: key, classified: ALLOWED.has(key) || DENIED.has(key) }).toEqual({ route: key, classified: true });
      expect({ route: key, test: demoMayWrite(r.method, concrete(r.path), false) }).toEqual({ route: key, test: ALLOWED.has(key) });
      expect({ route: key, live: demoMayWrite(r.method, concrete(r.path), true) }).toEqual({ route: key, live: false });
    }
    expect(seen.size).toBe(ALLOWED.size + DENIED.size);
  });

  it("FR_API_153_reads_are_never_refused", () => {
    expect(demoMayWrite("GET", "/v1/dashboard/me", true)).toBe(true);
    expect(demoMayWrite("HEAD", "/v1/products", false)).toBe(true);
  });
});

describe("FR-API-153 a demo session against the real routes", () => {
  const ORIGIN = "http://localhost:3000";
  let demoCookie: string;
  const as = (method: string, path: string, body?: unknown, mode: "test" | "live" = "test") =>
    api(method, path, { body, headers: { cookie: demoCookie, origin: ORIGIN, "x-elapse-mode": mode } });

  beforeEach(async () => {
    await resetDb();
    const demo = await ensureDemoMerchant();
    demoCookie = `elapse_session=${(await createSession(demo.id, null, { demo: true })).token}`;
    setFaucetClient(fakeFaucet().client);
  });
  afterEach(() => setFaucetClient(null));

  it("FR_API_153_creates_a_product_in_test_mode", async () => {
    const r = await as("POST", "/v1/products", { name: "Judge's GPU", rate_usd_per_second: "0.001" });
    expect(r.status).toBe(200);
  });

  it("FR_API_153_refuses_the_same_write_in_live_mode", async () => {
    const r = await as("POST", "/v1/products", { name: "Judge's GPU", rate_usd_per_second: "0.001" }, "live");
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ type: "permission_error", code: "demo_read_only", message: "Not available in the demo account. Sign in with your email to use it." });
  });

  it("FR_API_153_refuses_the_profile_payout_address_and_delete_test_data", async () => {
    for (const [path, body] of [
      ["/v1/dashboard/me", { name: "Defaced" }],
      ["/v1/dashboard/payout_address", { address: "0x2222222222222222222222222222222222222222", confirm: "0x2222222222222222222222222222222222222222" }],
      ["/v1/dashboard/test_data/delete", { confirm_name: "Acme Cloud (demo)" }],
    ] as const) {
      const r = await as("POST", path, body);
      expect({ path, status: r.status, code: r.body.error?.code }).toEqual({ path, status: 403, code: "demo_read_only" });
    }
    const [m] = await sql`SELECT name, payout_address FROM merchants WHERE demo`;
    expect(m).toEqual({ name: "Acme Cloud (demo)", payout_address: null });
  });

  it("FR_API_153_a_normal_session_of_the_same_merchant_is_not_limited", async () => {
    const [demo] = await sql`SELECT id FROM merchants WHERE demo`;
    demoCookie = `elapse_session=${(await createSession(demo!.id, null)).token}`;
    expect((await as("POST", "/v1/dashboard/me", { name: "Renamed" })).status).toBe(200);
  });

  it("FR_API_153_refuses_writes_that_target_a_seed_object_and_allows_the_same_on_a_judges_own", async () => {
    const [demo] = await sql`SELECT id FROM merchants WHERE demo`;
    await ensureSeedProducts(demo!.id);
    await ensureSeedEndpoints(demo!.id);
    await ensureExampleCredentials(demo!.id);
    const id = async (table: "products" | "webhook_endpoints" | "api_keys", key: string) =>
      (await sql`SELECT id FROM ${sql(table)} WHERE demo_seed_key = ${key}`)[0]!.id as string;
    const refused = [
      ["POST", `/v1/products/${await id("products", "product:saas")}`, { active: false }],
      ["POST", `/v1/products/${await id("products", "product:gpu")}`, { name: "Defaced" }],
      ["POST", `/v1/api_keys/${await id("api_keys", "key:saas")}/roll`, { grace: 0 }],
      ["DELETE", `/v1/api_keys/${await id("api_keys", "key:lambda")}`, undefined],
      ["DELETE", `/v1/webhook_endpoints/${await id("webhook_endpoints", "endpoint:saas")}`, undefined],
      ["POST", `/v1/webhook_endpoints/${await id("webhook_endpoints", "endpoint:lambda")}`, { url: "https://evil.example/hook" }],
      ["POST", `/v1/webhook_endpoints/${await id("webhook_endpoints", "endpoint:sink")}/roll_secret`, { grace: 0 }],
      ["POST", `/v1/webhook_endpoints/${await id("webhook_endpoints", "endpoint:saas")}/test`, {}],
    ] as const;
    for (const [method, path, body] of refused) {
      const r = await as(method, path, body);
      expect({ method, path, status: r.status, code: r.body?.error?.code }).toEqual({ method, path, status: 403, code: "demo_read_only" });
    }
    const [p] = await sql`SELECT active, name FROM products WHERE demo_seed_key = 'product:saas'`;
    expect(p).toEqual({ active: true, name: "GPU · 4090" });

    // The same writes on what the judge made go through.
    const mine = await as("POST", "/v1/products", { name: "Judge's GPU", rate_usd_per_second: "0.001" });
    expect((await as("POST", `/v1/products/${mine.body.id}`, { active: false })).status).toBe(200);
    const ep = await as("POST", "/v1/webhook_endpoints", { url: "https://judge.example/hook", events: ["*"] });
    expect((await as("DELETE", `/v1/webhook_endpoints/${ep.body.id}`)).status).toBe(200);
    const key = await as("POST", "/v1/api_keys", { name: "judge" });
    expect((await as("DELETE", `/v1/api_keys/${key.body.id}`)).status).toBe(200);
  });
});

