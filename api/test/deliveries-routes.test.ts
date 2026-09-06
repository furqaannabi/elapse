import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { createEvent } from "../src/db/events";
import { runOnce } from "../src/worker/run";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { startReceiver } from "./mock-receiver";

const receiver = startReceiver();
afterAll(() => receiver.stop());
const run = () => runOnce({ batch: 50, concurrency: 4, timeoutMs: 5_000, log: () => {} });

let f: Fixture;
let ep: { id: string };
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
  receiver.received.length = 0;
  receiver.respond(200, "ok");
  ep = (await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { url: receiver.url, events: ["*"] } })).body;
});

const evt = (livemode = false) =>
  createEvent({ merchantId: f.merchantId, livemode, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });

describe("FR-API-064 read routes", () => {
  test("GET /v1/deliveries/:id shows the delivery and every attempt with code, duration, headers incl. signature, excerpt", async () => {
    receiver.respond(500, "nope");
    const e = await evt();
    await run();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    const r = await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skTest });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: d!.id,
      object: "delivery",
      event: e.id,
      endpoint: ep.id,
      status: "retrying",
      attempt: 1,
      livemode: false,
      next_attempt_at: expect.any(Number),
      created: expect.any(Number),
    });
    expect(r.body.attempts).toHaveLength(1);
    expect(r.body.attempts[0]).toMatchObject({ n: 1, manual: false, status_code: 500, response_excerpt: "nope", error: null, duration_ms: expect.any(Number), sent_at: expect.any(Number) });
    expect(r.body.attempts[0].request_headers["X-Elapse-Signature"]).toMatch(/^t=\d+,v1=/);
    expect(JSON.stringify(r.body)).not.toContain("whsec_");
  });

  test("other mode / other merchant → 404; pk_ → 401", async () => {
    const e = await evt();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    expect((await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skLive })).status).toBe(404);
    const other = await seedMerchant();
    expect((await api("GET", `/v1/deliveries/${d!.id}`, { key: other.skTest })).status).toBe(404);
    expect((await api("GET", `/v1/deliveries/${d!.id}`, { key: f.pkTest })).status).toBe(401);
  });

  test("GET /v1/webhook_endpoints/:id/deliveries lists newest first with a last_attempt summary, paginated, filterable by event", async () => {
    receiver.respond(204);
    const e1 = await evt();
    const e2 = await evt();
    const e3 = await evt();
    await run();
    const r = await api("GET", `/v1/webhook_endpoints/${ep.id}/deliveries?limit=2`, { key: f.skTest });
    expect(r.status).toBe(200);
    expect(r.body.object).toBe("list");
    expect(r.body.has_more).toBe(true);
    expect(r.body.data.map((d: any) => d.event)).toEqual([e3.id, e2.id]);
    expect(r.body.data[0]).toMatchObject({ object: "delivery", status: "succeeded", attempt: 1, last_attempt: { n: 1, status_code: 204, error: null } });
    expect(r.body.data[0].attempts).toBeUndefined();
    const page2 = await api("GET", `/v1/webhook_endpoints/${ep.id}/deliveries?limit=2&starting_after=${r.body.data[1].id}`, { key: f.skTest });
    expect(page2.body.data.map((d: any) => d.event)).toEqual([e1.id]);
    expect(page2.body.has_more).toBe(false);
    const byEvent = await api("GET", `/v1/webhook_endpoints/${ep.id}/deliveries?event=${e2.id}`, { key: f.skTest });
    expect(byEvent.body.data.map((d: any) => d.event)).toEqual([e2.id]);
    expect((await api("GET", `/v1/webhook_endpoints/wh_nope/deliveries`, { key: f.skTest })).status).toBe(404);
  });

  test("a queued delivery has last_attempt null", async () => {
    await evt();
    const r = await api("GET", `/v1/webhook_endpoints/${ep.id}/deliveries`, { key: f.skTest });
    expect(r.body.data[0]).toMatchObject({ status: "queued", attempt: 0, last_attempt: null });
  });
});

describe("FR-WRK-030/031 resend", () => {
  test("resend on an exhausted delivery: 202, a manual attempt is sent freshly signed, status stays exhausted, schedule untouched, audit row", async () => {
    receiver.respond(500);
    const e = await evt();
    await sql`UPDATE deliveries SET status = 'exhausted', attempt = 8 WHERE event_id = ${e.id}`;
    const [d] = await sql`SELECT id, next_attempt_at FROM deliveries WHERE event_id = ${e.id}`;
    receiver.respond(200, "fixed");

    const r = await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skTest });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: d!.id, object: "delivery", status: "exhausted", resend_requested: true });
    expect(receiver.received).toHaveLength(0);

    const counts = await run();
    expect(counts.claimed).toBe(1);
    expect(receiver.received).toHaveLength(1);
    const sig = receiver.received[0]!.headers["x-elapse-signature"]!;
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(receiver.received[0]!.headers["x-elapse-delivery"]).toBe(d!.id);

    const [after] = await sql`SELECT status, attempt, next_attempt_at, manual_requested_at FROM deliveries WHERE id = ${d!.id}`;
    expect(after).toMatchObject({ status: "exhausted", attempt: 8, manual_requested_at: null });
    expect(new Date(after!.next_attempt_at).getTime()).toBe(new Date(d!.next_attempt_at).getTime());

    const got = await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skTest });
    const manual = got.body.attempts.find((a: any) => a.manual);
    expect(manual).toMatchObject({ manual: true, actor: expect.stringMatching(/^api_key:key_/), status_code: 200, response_excerpt: "fixed" });
    const [audit] = await sql`SELECT action, target, actor FROM audit_log WHERE action = 'delivery.resent'`;
    expect(audit).toMatchObject({ target: d!.id, actor: expect.stringMatching(/^api_key:/) });
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  test("resend on a succeeded delivery works too and does not change pending_webhooks", async () => {
    const e = await evt();
    await run();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    expect((await api("GET", `/v1/events/${e.id}`, { key: f.skTest })).body.pending_webhooks).toBe(0);
    await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skTest });
    await run();
    expect(receiver.received).toHaveLength(2);
    expect((await api("GET", `/v1/events/${e.id}`, { key: f.skTest })).body.pending_webhooks).toBe(0);
    expect((await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skTest })).body.status).toBe("succeeded");
  });

  test("three resends number their attempts 2, 3, 4 and the summary counts every attempt made (found 2026-09-06)", async () => {
    const e = await evt();
    await run();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    for (let i = 0; i < 3; i++) {
      await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skTest });
      await run();
    }
    const got = await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skTest });
    expect(got.body.attempts.map((a: any) => [a.n, a.manual])).toEqual([[1, false], [2, true], [3, true], [4, true]]);
    expect(got.body.attempts_made).toBe(4);
    // `attempt` still counts automatic attempts only; the schedule is untouched by resends.
    expect(got.body.attempt).toBe(1);
    const [{ endpoint_id }] = await sql`SELECT endpoint_id FROM deliveries WHERE id = ${d!.id}`;
    const list = await api("GET", `/v1/webhook_endpoints/${endpoint_id}/deliveries`, { key: f.skTest });
    expect(list.body.data.find((x: any) => x.id === d!.id)).toMatchObject({ attempts_made: 4, endpoint_disabled: false });
  });

  test("resend is refused on a disabled endpoint, and the event-level resend skips it (found 2026-09-06)", async () => {
    const e = await evt();
    await run();
    const [d] = await sql`SELECT id, endpoint_id FROM deliveries WHERE event_id = ${e.id}`;
    await api("POST", `/v1/webhook_endpoints/${d!.endpoint_id}`, { key: f.skTest, body: { disabled: true } });
    const r = await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skTest });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("disabled");
    const ev = await api("POST", `/v1/events/${e.id}/resend`, { key: f.skTest });
    expect(ev.status).toBe(202);
    expect(ev.body.data).toEqual([]);
    expect((await api("GET", `/v1/deliveries/${d!.id}`, { key: f.skTest })).body).toMatchObject({ resend_requested: false, endpoint_disabled: true });
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  test("a failed manual attempt does not touch the endpoint's failure streak", async () => {
    const e = await evt();
    await run();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    receiver.respond(500);
    await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skTest });
    await run();
    const [row] = await sql`SELECT failing_since FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row!.failing_since).toBeNull();
    const [a] = await sql`SELECT manual, status_code FROM delivery_attempts WHERE delivery_id = ${d!.id} AND manual = true`;
    expect(a).toMatchObject({ manual: true, status_code: 500 });
  });

  test("other mode → 404; pk_ → 401", async () => {
    const e = await evt();
    const [d] = await sql`SELECT id FROM deliveries WHERE event_id = ${e.id}`;
    expect((await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.skLive })).status).toBe(404);
    expect((await api("POST", `/v1/deliveries/${d!.id}/resend`, { key: f.pkTest })).status).toBe(401);
  });
});
