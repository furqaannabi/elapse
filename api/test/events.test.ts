import { beforeEach, describe, expect, test } from "bun:test";
import { constructEvent } from "@elapse/sdk";
import { sql } from "../src/db/client";
import { createEvent } from "../src/db/events";
import { signPayload } from "../src/lib/signature";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

const canceled = {
  id: "sub_3kP9mL2qR8tVxY",
  object: "subscription",
  status: "canceled",
  seconds_elapsed: 83,
  amount_settled: "0.332",
  currency: "ausd",
  product: "prod_9Xk2mQ1pL0vRsT",
  customer: "cus_2Lm8Nq4Rt7Vw1X",
};

async function endpoint(key: string, events: string[], extra: Record<string, unknown> = {}) {
  const r = await api("POST", "/v1/webhook_endpoints", { key, body: { url: "https://acme.test/hooks", events, ...extra } });
  expect(r.status).toBe(200);
  return r.body;
}

describe("FR-API-063 event object", () => {
  test("§5.3 shape; raw_body is the exact bytes of the object at creation", async () => {
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    expect(evt).toEqual({
      id: expect.stringMatching(/^evt_[0-9A-Za-z]{14}$/),
      object: "event",
      type: "subscription.canceled",
      created: expect.any(Number),
      livemode: false,
      data: { object: canceled },
      pending_webhooks: 0,
    });
    const [row] = await sql`SELECT raw_body, data FROM events WHERE id = ${evt.id}`;
    expect(row!.raw_body).toBe(JSON.stringify(evt));
    expect(JSON.parse(row!.raw_body)).toEqual(evt);
    expect(row!.data).toEqual({ object: canceled });
  });

  test("GET /v1/events/:id and ?type= filter; other mode → 404; pk_ → 401", async () => {
    const a = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    const b = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    await createEvent({ merchantId: f.merchantId, livemode: true, type: "invoice.settled", object: { id: "in_2", object: "invoice" } });
    const one = await api("GET", `/v1/events/${a.id}`, { key: f.skTest });
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ ...a, object_id: canceled.id, delivery_state: "delivered", deliveries: [] }); // reads add dashboard fields; the signed body (raw_body) does not
    expect((await api("GET", `/v1/events/${a.id}`, { key: f.skLive })).status).toBe(404);
    expect((await api("GET", `/v1/events/${a.id}`, { key: f.pkTest })).status).toBe(401);
    const all = await api("GET", "/v1/events", { key: f.skTest });
    expect(all.body.data.map((e: any) => e.id)).toEqual([b.id, a.id]);
    const filtered = await api("GET", "/v1/events?type=invoice.settled", { key: f.skTest });
    expect(filtered.body.data.map((e: any) => e.id)).toEqual([b.id]);
    expect((await api("GET", "/v1/events?type=invoice.tick", { key: f.skTest })).status).toBe(400);
  });

  test("the stored bytes verify with the SDK after signing, and parse back to the same event", async () => {
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    const [row] = await sql`SELECT raw_body FROM events WHERE id = ${evt.id}`;
    const t = Math.floor(Date.now() / 1000);
    const parsed = constructEvent(row!.raw_body, signPayload(row!.raw_body, ["whsec_test"], t), "whsec_test");
    expect(parsed as unknown).toEqual(evt);
  });
});

describe("FR-WRK-001 / FR-API-073 deliveries are created with the event, atomically", () => {
  test("one Delivery per matching, enabled endpoint of the same mode; pending_webhooks counts them", async () => {
    const yes1 = await endpoint(f.skTest, ["subscription.canceled"]);
    const yes2 = await endpoint(f.skTest, ["*"]);
    const noType = await endpoint(f.skTest, ["invoice.settled"]);
    const disabled = await endpoint(f.skTest, ["*"]);
    await api("POST", `/v1/webhook_endpoints/${disabled.id}`, { key: f.skTest, body: { disabled: true } });
    const liveEp = await endpoint(f.skLive, ["*"]);
    const other = await seedMerchant();
    const otherEp = await endpoint(other.skTest, ["*"]);

    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    expect(evt.pending_webhooks).toBe(2);
    const rows = await sql`SELECT endpoint_id, status, attempt, next_attempt_at <= now() AS due FROM deliveries WHERE event_id = ${evt.id} ORDER BY endpoint_id`;
    expect(rows.map((r: any) => r.endpoint_id).sort()).toEqual([yes1.id, yes2.id].sort());
    for (const r of rows) expect(r).toMatchObject({ status: "queued", attempt: 0, due: true });
    for (const id of [noType.id, disabled.id, liveEp.id, otherEp.id]) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM deliveries WHERE event_id = ${evt.id} AND endpoint_id = ${id}`;
      expect(n).toBe(0);
    }
    const got = await api("GET", `/v1/events/${evt.id}`, { key: f.skTest });
    expect(got.body.pending_webhooks).toBe(2);
  });

  test("pending_webhooks on read = deliveries not yet succeeded or exhausted", async () => {
    const a = await endpoint(f.skTest, ["*"]);
    const b = await endpoint(f.skTest, ["*"]);
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    await sql`UPDATE deliveries SET status = 'succeeded' WHERE event_id = ${evt.id} AND endpoint_id = ${a.id}`;
    expect((await api("GET", `/v1/events/${evt.id}`, { key: f.skTest })).body.pending_webhooks).toBe(1);
    await sql`UPDATE deliveries SET status = 'exhausted' WHERE event_id = ${evt.id} AND endpoint_id = ${b.id}`;
    expect((await api("GET", `/v1/events/${evt.id}`, { key: f.skTest })).body.pending_webhooks).toBe(0);
  });

  test("if a delivery insert fails, no event row exists either (one transaction)", async () => {
    await endpoint(f.skTest, ["*"]);
    await sql.unsafe(`CREATE OR REPLACE FUNCTION test_fail_delivery() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_delivery BEFORE INSERT ON deliveries FOR EACH ROW EXECUTE FUNCTION test_fail_delivery();`);
    try {
      await expect(createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } })).rejects.toThrow();
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM events WHERE merchant_id = ${f.merchantId}`;
      expect(n).toBe(0);
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS test_fail_delivery ON deliveries; DROP FUNCTION IF EXISTS test_fail_delivery();`);
    }
  });

  test("only the six catalog types can be created (BR-API-006)", async () => {
    await expect(createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.tick" as any, object: {} })).rejects.toThrow();
  });
});

describe("FR-API-061 POST /v1/webhook_endpoints/:id/test", () => {
  test("enqueues a synthetic event of the chosen type for that endpoint only", async () => {
    const target = await endpoint(f.skTest, ["*"]);
    const bystander = await endpoint(f.skTest, ["*"]);
    const r = await api("POST", `/v1/webhook_endpoints/${target.id}/test`, { key: f.skTest, body: { type: "subscription.canceled" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ object: "event", type: "subscription.canceled", livemode: false, pending_webhooks: 1 });
    expect(r.body.data.object).toMatchObject({ object: "subscription", status: "canceled", currency: "ausd" });
    const rows = await sql`SELECT endpoint_id FROM deliveries WHERE event_id = ${r.body.id}`;
    expect(rows.map((x: any) => x.endpoint_id)).toEqual([target.id]);
    void bystander;
  });

  test("type must be in the catalog; the endpoint must exist in this mode", async () => {
    const target = await endpoint(f.skTest, ["*"]);
    expect((await api("POST", `/v1/webhook_endpoints/${target.id}/test`, { key: f.skTest, body: { type: "nope" } })).status).toBe(400);
    expect((await api("POST", `/v1/webhook_endpoints/${target.id}/test`, { key: f.skLive, body: { type: "invoice.settled" } })).status).toBe(404);
  });

  test("a synthetic event is delivered even if the endpoint does not subscribe to that type (that is what test is for)", async () => {
    const target = await endpoint(f.skTest, ["invoice.settled"]);
    const r = await api("POST", `/v1/webhook_endpoints/${target.id}/test`, { key: f.skTest, body: { type: "subscription.created" } });
    expect(r.body.pending_webhooks).toBe(1);
  });
});
