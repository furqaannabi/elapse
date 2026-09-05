import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { constructEvent } from "@elapse/sdk";
import { sql } from "../src/db/client";
import { createEvent } from "../src/db/events";
import { claimDue } from "../src/worker/queue";
import { attemptDelivery, type DeliveryLogger } from "../src/worker/deliver";
import { runOnce } from "../src/worker/run";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { startReceiver } from "./mock-receiver";

const receiver = startReceiver();
afterAll(() => receiver.stop());

let f: Fixture;
const logs: Record<string, unknown>[] = [];
const logger: DeliveryLogger = (entry) => logs.push(entry);

beforeEach(async () => {
  await resetDb();
  await sql`DELETE FROM notifications`;
  f = await seedMerchant();
  receiver.received.length = 0;
  receiver.respond(200, "ok");
  logs.length = 0;
});

async function endpoint(opts: { key?: string; url?: string; events?: string[] } = {}) {
  const r = await api("POST", "/v1/webhook_endpoints", {
    key: opts.key ?? f.skTest,
    body: { url: opts.url ?? receiver.url, events: opts.events ?? ["*"] },
  });
  expect(r.status).toBe(200);
  return r.body as { id: string; secret: string };
}

async function event(livemode = false) {
  return createEvent({ merchantId: f.merchantId, livemode, type: "subscription.canceled", object: { id: "sub_1", object: "subscription", status: "canceled" } });
}

async function delivery(eventId: string) {
  const [d] = await sql`SELECT * FROM deliveries WHERE event_id = ${eventId}`;
  return d!;
}

const opts = (over: Partial<Parameters<typeof attemptDelivery>[1]> = {}) => ({ timeoutMs: 10_000, now: () => new Date(), log: logger, ...over });

describe("FR-WRK-010 claiming", () => {
  test("claims due queued/retrying rows, locks them for 60 s, and skips locked, future or finished rows", async () => {
    await endpoint();
    const e1 = await event();
    const e2 = await event();
    const e3 = await event();
    const e4 = await event();
    await sql`UPDATE deliveries SET next_attempt_at = now() + interval '1 hour' WHERE event_id = ${e2.id}`;
    await sql`UPDATE deliveries SET locked_until = now() + interval '30 seconds' WHERE event_id = ${e3.id}`;
    await sql`UPDATE deliveries SET status = 'succeeded' WHERE event_id = ${e4.id}`;
    const jobs = await claimDue(50);
    expect(jobs.map((j) => j.event_id)).toEqual([e1.id]);
    expect(jobs[0]!.locked_until.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(await claimDue(50)).toEqual([]);
  });

  test("two concurrent claimers never take the same job (200 jobs)", async () => {
    await endpoint();
    for (let i = 0; i < 200; i++) await event();
    const [a, b, c, d] = await Promise.all([claimDue(60), claimDue(60), claimDue(60), claimDue(60)]);
    const ids = [...a!, ...b!, ...c!, ...d!].map((j) => j.id);
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
  });

  test("a job carries what an attempt needs: raw_body, url, livemode, both secret blobs, disabled", async () => {
    const ep = await endpoint();
    const e = await event();
    const [job] = await claimDue(1);
    expect(job).toMatchObject({ event_id: e.id, endpoint_id: ep.id, url: receiver.url, livemode: false, attempt: 0, disabled: false });
    expect(job!.raw_body).toBe(JSON.stringify(e));
    expect(job!.secret_enc).toBeInstanceOf(Uint8Array);
    expect(job!.previous_secret_enc).toBeNull();
  });
});

describe("FR-WRK-011/020/021/023 one attempt on the wire", () => {
  test("POSTs the exact raw_body bytes with the required headers, and the signature verifies with the SDK", async () => {
    const ep = await endpoint();
    const e = await event();
    const [job] = await claimDue(1);
    const before = Math.floor(Date.now() / 1000);
    const outcome = await attemptDelivery(job!, opts());
    expect(outcome.status).toBe("succeeded");

    expect(receiver.received).toHaveLength(1);
    const req = receiver.received[0]!;
    expect(req.method).toBe("POST");
    expect(req.body).toBe(job!.raw_body);
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["user-agent"]).toBe("Elapse/1.0");
    expect(req.headers["x-elapse-delivery"]).toBe(job!.id);
    const sig = req.headers["x-elapse-signature"]!;
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const t = Number(/t=(\d+)/.exec(sig)![1]);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).not.toBe(e.created - 1);
    expect(constructEvent(req.body, sig, ep.secret).id).toBe(e.id);
    expect(JSON.stringify(req.headers)).not.toContain(ep.secret);
  });

  test("attempt row: n=1, status_code, duration, request headers incl. signature, excerpt ≤ 1024 bytes, no secret", async () => {
    const ep = await endpoint();
    await event();
    receiver.respond(200, "x".repeat(5000));
    const [job] = await claimDue(1);
    await attemptDelivery(job!, opts());
    const [a] = await sql`SELECT * FROM delivery_attempts WHERE delivery_id = ${job!.id}`;
    expect(a).toMatchObject({ n: 1, status_code: 200, manual: false, error: null });
    expect(a!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(a!.response_excerpt).toHaveLength(1024);
    expect(a!.request_headers["X-Elapse-Signature"]).toMatch(/^t=/);
    expect(JSON.stringify(a!.request_headers)).not.toContain(ep.secret);
    const d = await delivery(job!.event_id);
    expect(d).toMatchObject({ status: "succeeded", attempt: 1, locked_until: null });
  });

  test("FR-WRK-062 the structured log names ids and outcome, never body or secret", async () => {
    const ep = await endpoint();
    const e = await event();
    const [job] = await claimDue(1);
    await attemptDelivery(job!, opts());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ delivery_id: job!.id, event_id: e.id, type: "subscription.canceled", endpoint_id: ep.id, n: 1, status_code: 200, outcome: "succeeded" });
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain("sub_1");
    expect(dump).not.toContain(ep.secret.slice(6));
  });
});

describe("FR-WRK-012/013 outcomes and schedule", () => {
  test.each([
    [200, "succeeded"],
    [204, "succeeded"],
    [301, "retrying"],
    [400, "retrying"],
    [500, "retrying"],
  ] as [number, "succeeded" | "retrying"][])("HTTP %p → %s", async (code, expected) => {
    await endpoint();
    await event();
    receiver.respond(code);
    const [job] = await claimDue(1);
    const t0 = new Date();
    const out = await attemptDelivery(job!, opts({ now: () => t0 }));
    expect(out.status).toBe(expected);
    const d = await delivery(job!.event_id);
    expect(d.status).toBe(expected);
    if (expected === "retrying") expect(new Date(d.next_attempt_at).getTime()).toBe(t0.getTime() + 30_000);
  });

  test("timeout is a failure with error=timeout, and no redirect is followed", async () => {
    await endpoint();
    await event();
    receiver.respond(200, "late", 300);
    const [job] = await claimDue(1);
    const out = await attemptDelivery(job!, opts({ timeoutMs: 50 }));
    expect(out.status).toBe("retrying");
    const [a] = await sql`SELECT error, status_code FROM delivery_attempts WHERE delivery_id = ${job!.id}`;
    expect(a!.error).toBe("timeout");
    expect(a!.status_code).toBeNull();
  });

  test("connection refused is a failure with the error recorded", async () => {
    const dead = startReceiver();
    const url = dead.url;
    dead.stop();
    await endpoint({ url });
    await event();
    const [job] = await claimDue(1);
    const out = await attemptDelivery(job!, opts());
    expect(out.status).toBe("retrying");
    const [a] = await sql`SELECT error FROM delivery_attempts WHERE delivery_id = ${job!.id}`;
    expect(a!.error).toMatch(/refused|ECONNREFUSED|connect/i);
  });

  test("eight failures walk the schedule and end exhausted; attempts numbered 1..8", async () => {
    await endpoint();
    await event();
    receiver.respond(500);
    let t = new Date("2026-09-05T12:00:00Z");
    const deltas: number[] = [];
    for (let n = 1; n <= 8; n++) {
      await sql`UPDATE deliveries SET next_attempt_at = now(), locked_until = NULL`;
      const [job] = await claimDue(1);
      expect(job!.attempt).toBe(n - 1);
      const out = await attemptDelivery(job!, opts({ now: () => t }));
      const d = await delivery(job!.event_id);
      if (n < 8) {
        expect(out.status).toBe("retrying");
        deltas.push((new Date(d.next_attempt_at).getTime() - t.getTime()) / 1000);
        t = new Date(d.next_attempt_at);
      } else {
        expect(out.status).toBe("exhausted");
        expect(d.status).toBe("exhausted");
      }
    }
    expect(deltas).toEqual([30, 120, 600, 3600, 3600, 3600, 3600]);
    const rows = await sql`SELECT n FROM delivery_attempts WHERE delivery_id = (SELECT id FROM deliveries LIMIT 1) ORDER BY n`;
    expect(rows.map((r: any) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await claimDue(10)).toEqual([]);
  });
});

describe("FR-WRK-015 crashed worker", () => {
  test("an expired lock is reclaimed with the same attempt number and a lock_expired attempt row", async () => {
    await endpoint();
    await event();
    await sql`UPDATE deliveries SET locked_until = now() - interval '1 second'`;
    const [job] = await claimDue(1);
    expect(job!.reclaimed).toBe(true);
    await attemptDelivery(job!, opts());
    // Both rows can share a millisecond, so compare as a set.
    const rows = (await sql`SELECT n, error, status_code FROM delivery_attempts WHERE delivery_id = ${job!.id}`).map((r: any) => ({ ...r }));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([{ n: 1, error: "lock_expired", status_code: null }, { n: 1, error: null, status_code: 200 }]));
    expect((await delivery(job!.event_id)).attempt).toBe(1);
  });
});

describe("FR-WRK-016 / FR-WRK-032 guards at send time", () => {
  test("a live endpoint whose URL now points at a private address is not called; failure recorded as unsafe_url", async () => {
    const ep = await endpoint({ key: f.skLive, url: "https://acme.test/hooks" });
    await sql`UPDATE webhook_endpoints SET url = ${receiver.url} WHERE id = ${ep.id}`; // 127.0.0.1, http
    await event(true);
    const [job] = await claimDue(1);
    const out = await attemptDelivery(job!, opts());
    expect(out.status).toBe("retrying");
    expect(receiver.received).toHaveLength(0);
    const [a] = await sql`SELECT error FROM delivery_attempts WHERE delivery_id = ${job!.id}`;
    expect(a!.error).toBe("unsafe_url");
  });

  test("a delivery to a disabled endpoint is skipped without a request; re-enabling does not replay it", async () => {
    const ep = await endpoint();
    await event();
    await api("POST", `/v1/webhook_endpoints/${ep.id}`, { key: f.skTest, body: { disabled: true } });
    const [job] = await claimDue(1);
    const out = await attemptDelivery(job!, opts());
    expect(out.status).toBe("skipped");
    expect(receiver.received).toHaveLength(0);
    expect((await delivery(job!.event_id)).status).toBe("skipped");
    await api("POST", `/v1/webhook_endpoints/${ep.id}`, { key: f.skTest, body: { disabled: false } });
    expect(await claimDue(10)).toEqual([]);
  });
});

describe("FR-WRK-040 secret roll", () => {
  test("inside the grace window both secrets sign, new first, old last; the SDK verifies with either", async () => {
    const ep = await endpoint();
    const rolled = (await api("POST", `/v1/webhook_endpoints/${ep.id}/roll_secret`, { key: f.skTest, body: { grace: 3600 } })).body;
    await event();
    const [job] = await claimDue(1);
    await attemptDelivery(job!, opts());
    const sig = receiver.received[0]!.headers["x-elapse-signature"]!;
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
    const body = receiver.received[0]!.body;
    expect(constructEvent(body, sig, ep.secret).id).toBe(job!.event_id); // current SDK reads the last v1 = old secret
    const [, v1new] = sig.split(",");
    expect(constructEvent(body, `t=${/t=(\d+)/.exec(sig)![1]},${v1new}`, rolled.secret).id).toBe(job!.event_id);
  });

  test("after previous_secret_expires_at only the new secret signs and the old blob is nulled", async () => {
    const ep = await endpoint();
    const rolled = (await api("POST", `/v1/webhook_endpoints/${ep.id}/roll_secret`, { key: f.skTest, body: { grace: 3600 } })).body;
    await sql`UPDATE webhook_endpoints SET previous_secret_expires_at = now() - interval '1 second' WHERE id = ${ep.id}`;
    await event();
    const [job] = await claimDue(1);
    await attemptDelivery(job!, opts());
    const sig = receiver.received[0]!.headers["x-elapse-signature"]!;
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(constructEvent(receiver.received[0]!.body, sig, rolled.secret).id).toBe(job!.event_id);
    const [row] = await sql`SELECT previous_secret_enc, previous_secret_expires_at FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row!.previous_secret_enc).toBeNull();
    expect(row!.previous_secret_expires_at).toBeNull();
  });
});

describe("FR-WRK-050 time-based auto-disable", () => {
  const T0 = new Date("2026-09-05T00:00:00Z");
  const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

  async function failAt(when: Date) {
    await event();
    await sql`UPDATE deliveries SET next_attempt_at = now(), locked_until = NULL WHERE status IN ('queued','retrying')`;
    const jobs = await claimDue(10);
    for (const j of jobs) await attemptDelivery(j, opts({ now: () => when }));
  }

  test("first failure starts the streak; a success clears it", async () => {
    const ep = await endpoint();
    receiver.respond(500);
    await failAt(at(0));
    let [row] = await sql`SELECT failing_since, disabled FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(new Date(row!.failing_since).getTime()).toBe(at(0).getTime());
    receiver.respond(200);
    await failAt(at(1));
    [row] = await sql`SELECT failing_since, disabled FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row!.failing_since).toBeNull();
    expect(row!.disabled).toBe(false);
  });

  test("warning notification exactly once after 24 h; disable, audit and notification after 3 days", async () => {
    const ep = await endpoint();
    receiver.respond(500);
    await failAt(at(0));
    await failAt(at(23));
    expect((await sql`SELECT * FROM notifications WHERE target_id = ${ep.id}`).length).toBe(0);
    await failAt(at(25));
    await failAt(at(30));
    const warns = await sql`SELECT kind, summary FROM notifications WHERE target_id = ${ep.id} AND kind = 'endpoint_failing'`;
    expect(warns).toHaveLength(1);
    let [row] = await sql`SELECT disabled FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row!.disabled).toBe(false);

    await failAt(at(71));
    [row] = await sql`SELECT disabled FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row!.disabled).toBe(false);
    await failAt(at(72.5));
    [row] = await sql`SELECT disabled, disabled_reason FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row).toEqual({ disabled: true, disabled_reason: "auto:failing_3d" });
    const [n] = await sql`SELECT kind FROM notifications WHERE target_id = ${ep.id} AND kind = 'endpoint_exhausted'`;
    expect(n).toBeDefined();
    const [a] = await sql`SELECT action FROM audit_log WHERE target = ${ep.id} AND action = 'webhook_endpoint.auto_disabled'`;
    expect(a).toBeDefined();
  });

  test("re-enabling from the API clears the streak and the reason", async () => {
    const ep = await endpoint();
    receiver.respond(500);
    await failAt(at(0));
    await failAt(at(80));
    await api("POST", `/v1/webhook_endpoints/${ep.id}`, { key: f.skTest, body: { disabled: false } });
    const [row] = await sql`SELECT disabled, disabled_reason, failing_since, warned_24h_at FROM webhook_endpoints WHERE id = ${ep.id}`;
    expect(row).toEqual({ disabled: false, disabled_reason: null, failing_since: null, warned_24h_at: null });
  });
});

describe("runOnce", () => {
  test("processes every due job in the batch concurrently and reports counts", async () => {
    await endpoint();
    await endpoint();
    for (let i = 0; i < 5; i++) await event();
    const r = await runOnce({ batch: 50, concurrency: 4, timeoutMs: 10_000, log: logger });
    expect(r.claimed).toBe(10);
    expect(r.succeeded).toBe(10);
    expect(receiver.received).toHaveLength(10);
    expect((await runOnce({ batch: 50, concurrency: 4, timeoutMs: 10_000, log: logger })).claimed).toBe(0);
  });
});
