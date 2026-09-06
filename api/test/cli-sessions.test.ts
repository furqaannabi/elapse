import { beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { createEvent } from "../src/db/events";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

const canceled = { id: "sub_3kP9mL2qR8tVxY", object: "subscription", status: "canceled", seconds_elapsed: 83, amount_settled: "0.332", currency: "ausd" };

describe("FR-API-130 POST /v1/cli/sessions", () => {
  test("creates the merchant's one CLI endpoint per mode and returns its secret every time", async () => {
    const a = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    expect(a.status).toBe(200);
    expect(a.body).toEqual({
      id: expect.stringMatching(/^clis_[0-9A-Za-z]{14}$/),
      object: "cli_session",
      endpoint_id: expect.stringMatching(/^wh_/),
      signing_secret: expect.stringMatching(/^whsec_/),
      stream_url: expect.stringMatching(/^\/v1\/cli\/sessions\/clis_[0-9A-Za-z]{14}\/stream$/),
      livemode: false,
      merchant_name: "Acme GPU",
    });
    const b = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    expect(b.body.endpoint_id).toBe(a.body.endpoint_id);
    expect(b.body.signing_secret).toBe(a.body.signing_secret);
    expect(b.body.id).not.toBe(a.body.id);

    const live = await api("POST", "/v1/cli/sessions", { key: f.skLive });
    expect(live.body.livemode).toBe(true);
    expect(live.body.endpoint_id).not.toBe(a.body.endpoint_id);

    const list = await api("GET", "/v1/webhook_endpoints", { key: f.skTest });
    expect(list.body.data).toEqual([expect.objectContaining({ id: a.body.endpoint_id, kind: "cli", url: "cli://", events: ["*"] })]);
    expect(list.body.data[0]).not.toHaveProperty("secret");
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE merchant_id = ${f.merchantId} AND action = 'cli_session.created'`;
    expect(n).toBe(3);
  });

  test("pk_ and no key → 401; ordinary endpoints are kind http", async () => {
    expect((await api("POST", "/v1/cli/sessions", { key: f.pkTest })).status).toBe(401);
    expect((await api("POST", "/v1/cli/sessions")).status).toBe(401);
    const ep = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { url: "https://acme.test/hooks", events: ["*"] } });
    expect(ep.body.kind).toBe("http");
  });

  test("a CLI endpoint cannot be updated, rolled, deleted or tested through the endpoint routes", async () => {
    const { body } = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    const id = body.endpoint_id;
    expect((await api("POST", `/v1/webhook_endpoints/${id}`, { key: f.skTest, body: { disabled: true } })).status).toBe(400);
    expect((await api("POST", `/v1/webhook_endpoints/${id}/roll_secret`, { key: f.skTest, body: { grace: 0 } })).status).toBe(400);
    expect((await api("POST", `/v1/webhook_endpoints/${id}/test`, { key: f.skTest, body: { type: "invoice.settled" } })).status).toBe(400);
    expect((await api("DELETE", `/v1/webhook_endpoints/${id}`, { key: f.skTest })).status).toBe(400);
    expect((await api("GET", `/v1/webhook_endpoints/${id}`, { key: f.skTest })).status).toBe(200);
  });
});

describe("FR-API-134 a CLI endpoint receives Deliveries only while connected", () => {
  test("no stream open → no Delivery; connected → one Delivery; the worker never claims it", async () => {
    const { body } = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    const evt1 = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    expect(evt1.pending_webhooks).toBe(0);

    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${body.endpoint_id}`;
    const evt2 = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    expect(evt2.pending_webhooks).toBe(1);
    const { claimDue } = await import("../src/worker/queue");
    expect(await claimDue(10)).toEqual([]);

    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() - interval '1 second' WHERE id = ${body.endpoint_id}`;
    const evt3 = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    expect(evt3.pending_webhooks).toBe(0);
  });
});

describe("FR-API-133 POST /v1/events/:id/resend", () => {
  test("flags every Delivery of the Event for a manual attempt, including the CLI's while connected", async () => {
    const ep1 = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { url: "https://acme.test/a", events: ["*"] } });
    const ep2 = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { url: "https://acme.test/b", events: ["invoice.settled"] } });
    const s = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.body.endpoint_id}`;
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    await sql`UPDATE deliveries SET status = 'succeeded' WHERE event_id = ${evt.id}`;

    const r = await api("POST", `/v1/events/${evt.id}/resend`, { key: f.skTest });
    expect(r.status).toBe(202);
    expect(r.body.object).toBe("list");
    expect(r.body.data.map((d: any) => d.endpoint).sort()).toEqual([ep1.body.id, s.body.endpoint_id].sort());
    for (const d of r.body.data) expect(d).toMatchObject({ object: "delivery", status: "succeeded", resend_requested: true });
    void ep2;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM deliveries WHERE event_id = ${evt.id} AND manual_requested_at IS NOT NULL`;
    expect(n).toBe(2);
    const [{ a }] = await sql`SELECT count(*)::int AS a FROM audit_log WHERE merchant_id = ${f.merchantId} AND action = 'event.resent' AND target = ${evt.id}`;
    expect(a).toBe(1);
  });

  test("a CLI Delivery is not flagged while disconnected; unknown or other-mode Event → 404; pk_ → 401", async () => {
    const s = await api("POST", "/v1/cli/sessions", { key: f.skTest });
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.body.endpoint_id}`;
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    await sql`UPDATE webhook_endpoints SET cli_connected_until = NULL WHERE id = ${s.body.endpoint_id}`;
    const r = await api("POST", `/v1/events/${evt.id}/resend`, { key: f.skTest });
    expect(r.status).toBe(202);
    expect(r.body.data).toEqual([]);
    expect((await api("POST", `/v1/events/${evt.id}/resend`, { key: f.skLive })).status).toBe(404);
    expect((await api("POST", `/v1/events/evt_nope/resend`, { key: f.skTest })).status).toBe(404);
    expect((await api("POST", `/v1/events/${evt.id}/resend`, { key: f.pkTest })).status).toBe(401);
  });
});
