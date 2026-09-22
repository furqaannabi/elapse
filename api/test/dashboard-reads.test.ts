import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let m: Fixture;
beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
});

async function endpointWithTestEvent() {
  const ep = await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://merchant.example/hooks", events: ["*"] } });
  const ev = await api("POST", `/v1/webhook_endpoints/${ep.body.id}/test`, { key: m.skTest, body: { type: "subscription.created" } });
  return { endpointId: ep.body.id as string, eventId: ev.body.id as string };
}

describe("dashboard-facing fields on deliveries, events, endpoints", () => {
  it("deliveries carry event type/created and endpoint url so the table needs one call", async () => {
    const { endpointId, eventId } = await endpointWithTestEvent();
    const list = await api("GET", `/v1/webhook_endpoints/${endpointId}/deliveries`, { key: m.skTest });
    expect(list.body.data[0]).toMatchObject({ event: eventId, event_type: "subscription.created", event_created: expect.any(Number), endpoint: endpointId, endpoint_url: "https://merchant.example/hooks" });
    const one = await api("GET", `/v1/deliveries/${list.body.data[0].id}`, { key: m.skTest });
    expect(one.body).toMatchObject({ event_type: "subscription.created", endpoint_url: "https://merchant.example/hooks", attempts: [] });
    expect(one.body.max_attempts).toBe(8);
  });

  it("events carry delivery_state (pending → delivered → failed) and retrieve lists their deliveries", async () => {
    const { eventId } = await endpointWithTestEvent();
    let ev = await api("GET", `/v1/events/${eventId}`, { key: m.skTest });
    expect(ev.body.delivery_state).toBe("pending");
    expect(ev.body.deliveries).toHaveLength(1);
    await sql`UPDATE deliveries SET status = 'succeeded' WHERE event_id = ${eventId}`;
    ev = await api("GET", `/v1/events/${eventId}`, { key: m.skTest });
    expect(ev.body.delivery_state).toBe("delivered");
    const list = await api("GET", "/v1/events", { key: m.skTest });
    expect(list.body.data[0].delivery_state).toBe("delivered");
    await sql`UPDATE deliveries SET status = 'exhausted' WHERE event_id = ${eventId}`;
    expect((await api("GET", `/v1/events/${eventId}`, { key: m.skTest })).body.delivery_state).toBe("failed");
  });

  it("endpoints carry success_rate_7d over finished deliveries, 1 when none", async () => {
    const { endpointId, eventId } = await endpointWithTestEvent();
    let ep = await api("GET", `/v1/webhook_endpoints/${endpointId}`, { key: m.skTest });
    expect(ep.body.success_rate_7d).toBe(1);
    await sql`UPDATE deliveries SET status = 'exhausted' WHERE event_id = ${eventId}`;
    await api("POST", `/v1/webhook_endpoints/${endpointId}/test`, { key: m.skTest, body: { type: "invoice.settled" } });
    await sql`UPDATE deliveries SET status = 'succeeded' WHERE status = 'queued'`;
    ep = await api("GET", `/v1/webhook_endpoints/${endpointId}`, { key: m.skTest });
    expect(ep.body.success_rate_7d).toBe(0.5);
    const list = await api("GET", "/v1/webhook_endpoints", { key: m.skTest });
    expect(list.body.data[0].success_rate_7d).toBe(0.5);
  });

  it("events list accepts since/until and the object id is exposed", async () => {
    const { eventId } = await endpointWithTestEvent();
    const now = Math.floor(Date.now() / 1000);
    const list = await api("GET", `/v1/events?since=${now - 60}&until=${now + 60}`, { key: m.skTest });
    expect(list.body.data.map((e: any) => e.id)).toContain(eventId);
    expect(list.body.data[0].object_id).toMatch(/^sub_/);
    expect((await api("GET", `/v1/events?until=${now - 3600}`, { key: m.skTest })).body.data).toEqual([]);
  });
});

describe("products carry active_subscriptions", () => {
  it("counts active and paused subscriptions per product, per mode", async () => {
    const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
    expect(p.body.active_subscriptions).toBe(0);
    await sql`INSERT INTO customers (id, merchant_id, livemode, wallet_address) VALUES ('cus_x', ${m.merchantId}, false, '0x0000000000000000000000000000000000000001')`;
    for (const [id, status] of [["sub_a", "active"], ["sub_b", "paused"], ["sub_c", "canceled"], ["sub_d", "incomplete"]]) {
      await sql`INSERT INTO subscriptions (id, merchant_id, livemode, product_id, customer_id, status, chain_id, rate_per_second_wei, max_duration_seconds, max_escrow_wei)
                VALUES (${id}, ${m.merchantId}, false, ${p.body.id}, 'cus_x', ${status}, 10143, 4000, 60, 240000)`;
    }
    expect((await api("GET", `/v1/products/${p.body.id}`, { key: m.skTest })).body.active_subscriptions).toBe(2);
    expect((await api("GET", "/v1/products", { key: m.skTest })).body.data[0].active_subscriptions).toBe(2);
  });
});

describe("customers carry subscription_count and total_settled_usd", () => {
  it("aggregates per customer and searches by email", async () => {
    const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
    await sql`INSERT INTO customers (id, merchant_id, livemode, wallet_address, email) VALUES ('cus_1', ${m.merchantId}, false, '0x0000000000000000000000000000000000000001', 'ann@x.test'), ('cus_2', ${m.merchantId}, false, '0x0000000000000000000000000000000000000002', NULL)`;
    for (const [id, cus, settled] of [["sub_1", "cus_1", 332000], ["sub_2", "cus_1", 100000], ["sub_3", "cus_2", 0]]) {
      await sql`INSERT INTO subscriptions (id, merchant_id, livemode, product_id, customer_id, status, chain_id, rate_per_second_wei, max_duration_seconds, max_escrow_wei, settled_wei)
                VALUES (${id}, ${m.merchantId}, false, ${p.body.id}, ${cus}, 'canceled', 10143, 4000, 60, 240000, ${settled})`;
    }
    const one = await api("GET", "/v1/customers/cus_1", { key: m.skTest });
    expect(one.body).toMatchObject({ subscription_count: 2, total_settled_usd: "0.432" });
    const list = await api("GET", "/v1/customers?search=ann", { key: m.skTest });
    expect(list.body.data.map((c: any) => c.id)).toEqual(["cus_1"]);
    expect((await api("GET", "/v1/customers", { key: m.skTest })).body.data).toHaveLength(2);
  });
});

describe("FR-API-146 an event nobody received does not report as delivered", () => {
  it("reads not_sent when fan-out matched no endpoint at all", async () => {
    // With `elapse listen` down, FR-API-134 excludes the CLI endpoint from fan-out, so the event
    // produced no Delivery. The rollup's ELSE called that delivered, and the Events page — the one
    // a merchant opens precisely because a webhook did not arrive — told them it had.
    const body = JSON.stringify({ id: "evt_nobody", object: "event", type: "subscription.created", created: 1, livemode: false, data: { object: { id: "sub_x" } } });
    await sql`INSERT INTO events (id, merchant_id, livemode, type, data, raw_body, created, pending_webhooks)
              VALUES ('evt_nobody', ${m.merchantId}, false, 'subscription.created', ${{ object: { id: "sub_x" } }}, ${body}, now(), 0)`;
    const ev = await api("GET", "/v1/events/evt_nobody", { key: m.skTest });
    expect(ev.body.delivery_state).toBe("not_sent");
    expect(ev.body.deliveries).toEqual([]);
  });

  it("reads not_sent for an event whose every delivery was skipped", async () => {
    // `cli_not_acked` after ten minutes, or `endpoint_disabled` after auto-disable. A Delivery
    // existed and was abandoned; nothing is still trying.
    const { eventId } = await endpointWithTestEvent();
    await sql`UPDATE deliveries SET status = 'skipped' WHERE event_id = ${eventId}`;
    expect((await api("GET", `/v1/events/${eventId}`, { key: m.skTest })).body.delivery_state).toBe("not_sent");
  });

  it("still reads delivered when one endpoint succeeded beside one that was skipped", async () => {
    const { eventId } = await endpointWithTestEvent();
    const ep2 = await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://other.example/hooks", events: ["*"] } });
    await sql`INSERT INTO deliveries (id, event_id, endpoint_id, status) VALUES ('dlv_second', ${eventId}, ${ep2.body.id}, 'succeeded')`;
    await sql`UPDATE deliveries SET status = 'skipped' WHERE event_id = ${eventId} AND id <> 'dlv_second'`;
    expect((await api("GET", `/v1/events/${eventId}`, { key: m.skTest })).body.delivery_state).toBe("delivered");
  });
});
