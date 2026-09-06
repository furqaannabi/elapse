import { beforeEach, describe, expect, test } from "bun:test";
import { constructEvent } from "@elapse/sdk";
import { sql } from "../src/db/client";
import { createEvent } from "../src/db/events";
import { app } from "../src/app";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";

let f: Fixture;
beforeEach(async () => {
  await resetDb();
  f = await seedMerchant();
});

const canceled = { id: "sub_3kP9mL2qR8tVxY", object: "subscription", status: "canceled", seconds_elapsed: 83, amount_settled: "0.332", currency: "ausd" };

interface Frame { event: string; id?: string; data: any }

/** Open the SSE stream and collect frames until `until(frames)` is true or `timeoutMs` passes; then cancel it. */
async function readStream(path: string, key: string, until: (frames: Frame[]) => boolean, timeoutMs = 2000): Promise<{ status: number; frames: Frame[]; headers: Headers }> {
  const res = await app.request(path, { headers: { authorization: `Bearer ${key}` } });
  if (res.status !== 200 || !res.body) return { status: res.status, frames: [], headers: res.headers };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !until(frames)) {
    const next = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined }))]);
    if (next.done) break;
    buf += decoder.decode(next.value);
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const frame: Frame = { event: "message", data: null };
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) frame.event = line.slice(7);
        else if (line.startsWith("id: ")) frame.id = line.slice(4);
        else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      }
      frame.data = JSON.parse(dataLines.join("\n"));
      frames.push(frame);
    }
  }
  await reader.cancel();
  return { status: 200, frames, headers: res.headers };
}

async function session(key = f.skTest) {
  const r = await api("POST", "/v1/cli/sessions", { key });
  return r.body as { id: string; endpoint_id: string; signing_secret: string; stream_url: string };
}

describe("FR-API-131 GET /v1/cli/sessions/:id/stream", () => {
  test("marks the endpoint connected, streams a signed frame whose bytes verify with the SDK, heartbeats", async () => {
    const s = await session();
    const pending = readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "delivery") && fr.some((x) => x.event === "heartbeat"), 3000);
    await Bun.sleep(150); // the stream is open: the endpoint now counts as connected, so this Event creates a CLI Delivery
    await createEvent({ merchantId: f.merchantId, livemode: false, type: "subscription.canceled", object: canceled });
    const got = await pending;
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toContain("text/event-stream");
    const delivery = got.frames.find((x) => x.event === "delivery")!;
    expect(delivery).toBeDefined();
    expect(delivery.id).toBe(delivery.data.id);
    expect(delivery.data).toEqual({
      id: expect.stringMatching(/^dlv_/),
      event_id: expect.stringMatching(/^evt_/),
      type: "subscription.canceled",
      created: expect.any(Number),
      headers: { "Content-Type": "application/json", "X-Elapse-Signature": expect.stringMatching(/^t=\d+,v1=[0-9a-f]{64}$/), "X-Elapse-Delivery": delivery.data.id },
      raw_body: expect.any(String),
    });
    const [row] = await sql`SELECT raw_body FROM events WHERE id = ${delivery.data.event_id}`;
    expect(delivery.data.raw_body).toBe(row!.raw_body);
    const parsed = constructEvent(delivery.data.raw_body, delivery.data.headers["X-Elapse-Signature"], s.signing_secret);
    expect(parsed.id).toBe(delivery.data.event_id);
    const hb = got.frames.find((x) => x.event === "heartbeat")!;
    expect(hb.data).toEqual({ at: expect.any(Number) });
  });

  test("another merchant's session, the other mode, or pk_ → 404 / 401", async () => {
    const s = await session();
    expect((await app.request(s.stream_url, { headers: { authorization: `Bearer ${f.skLive}` } })).status).toBe(404);
    expect((await app.request(s.stream_url, { headers: { authorization: `Bearer ${f.pkTest}` } })).status).toBe(401);
    const other = await seedMerchant();
    expect((await app.request(s.stream_url, { headers: { authorization: `Bearer ${other.skTest}` } })).status).toBe(404);
  });

  test("a frame still unacked is sent again on the next connection; an acked one is not", async () => {
    const s = await session();
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.endpoint_id}`;
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    const first = await readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "delivery"));
    const dlv = first.frames.find((x) => x.event === "delivery")!.data;
    expect(dlv.event_id).toBe(evt.id);
    const second = await readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "delivery"), 300);
    expect(second.frames.filter((x) => x.event === "delivery").map((x) => x.data.id)).toEqual([dlv.id]);
    const ack = await api("POST", `${s.stream_url.replace(/\/stream$/, "")}/deliveries/${dlv.id}/ack`, { key: f.skTest, body: { status_code: 200, duration_ms: 12, headers: dlv.headers } });
    expect(ack.status).toBe(200);
    const third = await readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "delivery"), 300);
    expect(third.frames.filter((x) => x.event === "delivery")).toEqual([]);
  });
});

describe("FR-API-132 ack", () => {
  async function frame() {
    const s = await session();
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.endpoint_id}`;
    await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    const got = await readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "delivery"));
    const d = got.frames.find((x) => x.event === "delivery")!.data;
    return { s, d, ackPath: `/v1/cli/sessions/${s.id}/deliveries/${d.id}/ack` };
  }

  test("2xx → succeeded with an attempt row the dashboard shows; the event is no longer pending", async () => {
    const { d, ackPath } = await frame();
    const r = await api("POST", ackPath, { key: f.skTest, body: { status_code: 200, duration_ms: 9, headers: d.headers } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: d.id, object: "delivery", status: "succeeded", attempt: 1 });
    const full = await api("GET", `/v1/deliveries/${d.id}`, { key: f.skTest });
    expect(full.body.attempts).toEqual([expect.objectContaining({ n: 1, status_code: 200, duration_ms: 9, actor: "cli", request_headers: expect.objectContaining({ "X-Elapse-Signature": d.headers["X-Elapse-Signature"] }) })]);
    expect((await api("GET", `/v1/events/${d.event_id}`, { key: f.skTest })).body.pending_webhooks).toBe(0);
  });

  test("non-2xx or an error → exhausted after this single attempt; printed_only records 200", async () => {
    const { d, ackPath } = await frame();
    const r = await api("POST", ackPath, { key: f.skTest, body: { status_code: 500, duration_ms: 3 } });
    expect(r.body.status).toBe("exhausted");
    const again = await frame();
    const e = await api("POST", again.ackPath, { key: f.skTest, body: { error: "ECONNREFUSED", duration_ms: 1 } });
    expect(e.body.status).toBe("exhausted");
    const [att] = await sql`SELECT error, status_code FROM delivery_attempts WHERE delivery_id = ${again.d.id}`;
    expect(att).toEqual({ error: "ECONNREFUSED", status_code: null });
    const third = await frame();
    const p = await api("POST", third.ackPath, { key: f.skTest, body: { printed_only: true, duration_ms: 0 } });
    expect(p.body.status).toBe("succeeded");
  });

  test("double ack → 409; a delivery of another session's endpoint → 404; body validated", async () => {
    const { d, ackPath } = await frame();
    await api("POST", ackPath, { key: f.skTest, body: { status_code: 200, duration_ms: 1 } });
    expect((await api("POST", ackPath, { key: f.skTest, body: { status_code: 200, duration_ms: 1 } })).status).toBe(409);
    expect((await api("POST", ackPath, { key: f.skTest, body: { duration_ms: 1 } })).status).toBe(400);
    const other = await seedMerchant();
    const os = await session(other.skTest);
    expect((await api("POST", `/v1/cli/sessions/${os.id}/deliveries/${d.id}/ack`, { key: other.skTest, body: { status_code: 200, duration_ms: 1 } })).status).toBe(404);
  });
});

describe("FR-API-134 expiry", () => {
  test("a CLI Delivery still queued after 10 minutes is skipped by the stream's poll", async () => {
    const s = await session();
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.endpoint_id}`;
    const evt = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    await sql`UPDATE deliveries SET created_at = now() - interval '11 minutes' WHERE event_id = ${evt.id}`;
    const got = await readStream(s.stream_url, f.skTest, (fr) => fr.some((x) => x.event === "heartbeat"), 1000);
    expect(got.frames.filter((x) => x.event === "delivery")).toEqual([]);
    const [row] = await sql`SELECT status FROM deliveries WHERE event_id = ${evt.id}`;
    expect(row!.status).toBe("skipped");
    const [att] = await sql`SELECT error FROM delivery_attempts da JOIN deliveries d ON d.id = da.delivery_id WHERE d.event_id = ${evt.id}`;
    expect(att!.error).toBe("cli_not_acked");
  });
});

describe("FR-API-134 worker sweep", () => {
  test("expireUnacked(null) skips stale CLI rows across endpoints and leaves http rows and fresh rows alone", async () => {
    const { expireUnacked } = await import("../src/services/cli-stream");
    const s = await session();
    const http = await api("POST", "/v1/webhook_endpoints", { key: f.skTest, body: { url: "https://acme.test/a", events: ["*"] } });
    await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + interval '60 seconds' WHERE id = ${s.endpoint_id}`;
    const old = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_1", object: "invoice" } });
    const fresh = await createEvent({ merchantId: f.merchantId, livemode: false, type: "invoice.settled", object: { id: "in_2", object: "invoice" } });
    await sql`UPDATE deliveries SET created_at = now() - interval '11 minutes' WHERE event_id = ${old.id}`;
    expect(await expireUnacked(null)).toBe(1);
    const rows = await sql`SELECT d.event_id, d.endpoint_id, d.status FROM deliveries d ORDER BY d.event_id, d.endpoint_id`;
    expect(rows.find((r: any) => r.event_id === old.id && r.endpoint_id === s.endpoint_id)!.status).toBe("skipped");
    expect(rows.find((r: any) => r.event_id === old.id && r.endpoint_id === http.body.id)!.status).toBe("queued");
    expect(rows.filter((r: any) => r.event_id === fresh.id).every((r: any) => r.status === "queued")).toBe(true);
  });
});
