/**
 * FR-API-155: the demo's webhook sink (ADR 2026-10-02 demo account). It verifies a delivery the way
 * a merchant's server would — `constructEvent` from @elapse/sdk — against the demo seed endpoint's
 * secret only.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { resetDb, seedMerchant } from "./helpers";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { ensureDemoMerchant } from "../src/db/demo";
import { insertWebhookEndpoint } from "../src/db/webhook-endpoints";
import { signPayload } from "../src/lib/signature";

let secret: string;
const body = JSON.stringify({ id: "evt_demo1", object: "event", type: "subscription.created", data: { object: {} } });
const now = () => Math.floor(Date.now() / 1000);
const post = (raw: string, signature?: string) =>
  app.request("/v1/demo/webhooks", { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-elapse-signature": signature } : {}) }, body: raw });

beforeEach(async () => {
  await resetDb();
  const demo = await ensureDemoMerchant();
  const ep = await insertWebhookEndpoint({ merchantId: demo.id, livemode: false, url: "https://api.test/v1/demo/webhooks", events: ["*"], actor: "demo_seed" });
  await sql`UPDATE webhook_endpoints SET demo_seed = true WHERE id = ${ep.row.id}`;
  secret = ep.secret;
});

describe("FR-API-155 demo webhook sink", () => {
  it("FR_API_155_accepts_a_delivery_signed_for_the_demo_endpoint", async () => {
    const r = await post(body, signPayload(body, [secret], now()));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true });
  });

  it("FR_API_155_refuses_a_tampered_body_an_old_timestamp_and_a_missing_header", async () => {
    expect((await post(body.replace("created", "canceled"), signPayload(body, [secret], now()))).status).toBe(400);
    expect((await post(body, signPayload(body, [secret], now() - 301))).status).toBe(400);
    expect((await post(body)).status).toBe(400);
  });

  it("FR_API_155_refuses_another_endpoints_signature", async () => {
    const other = await seedMerchant();
    const ep = await insertWebhookEndpoint({ merchantId: other.merchantId, livemode: false, url: "https://x.test/hook", events: ["*"], actor: "test" });
    expect((await post(body, signPayload(body, [ep.secret], now()))).status).toBe(400);
  });

  it("FR_API_155_accepts_the_previous_secret_during_a_roll", async () => {
    const old = secret;
    await sql`UPDATE webhook_endpoints SET previous_secret_enc = secret_enc, previous_secret_expires_at = now() + interval '1 hour',
              secret_enc = ${(await import("../src/lib/crypto")).encryptSecret("whsec_rolled")} WHERE demo_seed`;
    expect((await post(body, signPayload(body, [old], now()))).status).toBe(200);
    expect((await post(body, signPayload(body, ["whsec_rolled"], now()))).status).toBe(200);
  });

  it("FR_API_155_without_a_demo_endpoint_everything_is_refused", async () => {
    await sql`DELETE FROM webhook_endpoints`;
    expect((await post(body, signPayload(body, [secret], now()))).status).toBe(400);
  });
});
