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
