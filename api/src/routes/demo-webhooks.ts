import { Hono } from "hono";
import { constructEvent } from "@elapse/sdk";
import { demoSinkSecrets } from "../db/demo";

/**
 * The demo account's webhook endpoint (FR-API-155, ADR 2026-10-02 demo account). It does what a
 * merchant's server does with an Elapse delivery: verify `X-Elapse-Signature` on the raw body with
 * `@elapse/sdk`'s `constructEvent`, then answer 200 — or 400 when the signature does not hold. It
 * accepts only the demo seed endpoint's secret, stores nothing, and logs the `evt_` id only.
 * Unauthenticated, like any merchant's endpoint, and hidden from the public reference.
 */
export const demoWebhooks = new Hono();

demoWebhooks.post("/demo/webhooks", async (c) => {
  const raw = await c.req.text();
  const secrets = await demoSinkSecrets();
  try {
    if (secrets.length === 0) throw new Error("no demo endpoint");
    const event = constructEvent(raw, c.req.header("x-elapse-signature"), secrets);
    console.log("demo_webhook_received", { event: event.id });
    return c.json({ received: true }, 200);
  } catch {
    return c.json({ error: { type: "invalid_request_error", message: "Signature verification failed." } }, 400);
  }
});
