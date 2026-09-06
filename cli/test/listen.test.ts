import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { forward } from "../src/forward";
import { listen, type ListenOptions } from "../src/commands/listen";
import { startMockPlatform, startReceiver, type MockPlatform } from "./mock-platform";

// A real-shaped body with an escaped unicode sequence and a double space, so byte-for-byte forwarding is proven (BR-CLI-001).
const RAW = '{"id":"evt_2b","object":"event","type":"subscription.canceled","created":1756800146,"livemode":false,"pending_webhooks":1,"data":{"object":{"id":"sub_4QeABC","object":"subscription","status":"canceled","customer":"cus_7HaXYZ","product":"prod_9f2K","rate_usd_per_second":"0.004","seconds_elapsed":83,"amount_settled":"0.332","ended_reason":"canceled","description":"GPU \u00b7 4090  (2 spaces)"}}}';

describe("FR-CLI-013/014 forward", () => {
  test("posts the exact bytes and the X-Elapse-* headers; reports status and duration", async () => {
    const rx = await startReceiver(200);
    try {
      const r = await forward(rx.url, RAW, { "Content-Type": "application/json", "X-Elapse-Signature": "t=1,v1=ab", "X-Elapse-Delivery": "dlv_1" }, { timeoutMs: 1000 });
      expect(r).toEqual({ ok: true, status: 200, statusText: "OK", durationMs: expect.any(Number) });
      expect(rx.received[0]!.body).toBe(RAW);
      expect(rx.received[0]!.headers["x-elapse-signature"]).toBe("t=1,v1=ab");
      expect(rx.received[0]!.headers["x-elapse-delivery"]).toBe("dlv_1");
      expect(rx.received[0]!.headers["content-type"]).toBe("application/json");
      expect(rx.received[0]!.headers["user-agent"]).toMatch(/^elapse-cli\//);
    } finally {
      await rx.close();
    }
  });

  test("connection refused and timeout are reported, not thrown", async () => {
    const closed = await startReceiver(200);
    await closed.close();
    const refused = await forward(closed.url, RAW, {}, { timeoutMs: 1000 });
    expect(refused).toEqual({ ok: false, error: "ECONNREFUSED", durationMs: expect.any(Number) });
    const slow = await startReceiver(200, 300);
    try {
      const t = await forward(slow.url, RAW, {}, { timeoutMs: 50 });
      expect(t).toEqual({ ok: false, error: "timeout after 50 ms", durationMs: expect.any(Number) });
    } finally {
      await slow.close();
    }
  });
});

describe("FR-CLI-010..017 elapse listen --forward", () => {
  let platform: MockPlatform;
  let out: string[];
  let err: string[];
  const base = (over: Partial<ListenOptions> = {}): ListenOptions => ({
    baseUrl: platform.url,
    key: "sk_test_abc",
    forward: undefined,
    events: undefined,
    compact: false,
    printSecret: false,
    live: false,
    json: false,
    color: false,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    sleep: async () => {},
    forwardTimeoutMs: 1000,
    ...over,
  });
  beforeEach(async () => {
    platform = await startMockPlatform();
    out = [];
    err = [];
  });
  afterEach(async () => {
    await platform.close();
  });

  async function until(pred: () => boolean, ms = 2000) {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(pred()).toBe(true);
  }

  test("startup prints the secret once and Ready; a delivery is forwarded byte-for-byte, printed, acked with the local status", async () => {
    const rx = await startReceiver(200);
    const ac = new AbortController();
    const port = new URL(rx.url).port;
    const done = listen(base({ forward: `localhost:${port}/webhooks`, signal: ac.signal }));
    await until(() => out.some((l) => l.startsWith("Ready.")));
    expect(out.join("\n")).toContain("whsec_mock000000000000000000000000000");
    expect(out.join("\n")).toContain(`Ready. Forwarding to http://localhost:${port}/webhooks`);
    expect(out.join("\n")).toContain("test mode · merchant Acme GPU");
    platform.emit({ id: "dlv_1", event_id: "evt_2b", type: "subscription.canceled", raw_body: RAW });
    await until(() => platform.acks.length === 1);
    expect(rx.received[0]!.body).toBe(RAW);
    expect(rx.received[0]!.headers["x-elapse-signature"]).toMatch(/^t=\d+,v1=/);
    expect(platform.acks[0]).toEqual({ delivery: "dlv_1", body: { status_code: 200, duration_ms: expect.any(Number), headers: expect.objectContaining({ "X-Elapse-Signature": expect.any(String) }) } });
    const line = out.find((l) => l.includes("evt_2b"))!;
    expect(line).toMatch(/^\d\d:\d\d:\d\d  evt_2b\s+subscription\.canceled\s+→ 200 OK \(\d+ ms\)$/);
    expect(out.join("\n")).toContain("X-Elapse-Signature: t=");
    expect(out.join("\n")).toContain('"seconds_elapsed": 83');
    ac.abort();
    const summary = await done;
    expect(summary).toEqual({ received: 1, forwarded: 1, failed: 0, skipped: 0 });
    await rx.close();
    // The docs' "what you will see" block (docs FR-DOC-024) is this output with the volatile parts fixed.
    const normalized = out
      .join("\n")
      .replace(/^\d\d:\d\d:\d\d /gm, "14:02:26 ")
      .replace(`localhost:${port}`, "localhost:3000")
      .replace(/\(\d+ ms\)/g, "(8 ms)")
      .replace(/t=\d+,v1=[0-9a-f]+/g, "t=1700000000,v1=5f1c…e9a2");
    const fixture = new URL("./fixtures/listen-output.txt", import.meta.url);
    if (process.env.UPDATE_FIXTURES) writeFileSync(fixture, `${normalized}\n`);
    expect(`${normalized}\n`).toBe(readFileSync(fixture, "utf8"));
  });

  test("a 500 and a refused connection are printed and acked as failures; listening continues", async () => {
    const rx = await startReceiver(500);
    const ac = new AbortController();
    const done = listen(base({ forward: rx.url, signal: ac.signal }));
    await until(() => out.some((l) => l.startsWith("Ready.")));
    platform.emit({ id: "dlv_1", event_id: "evt_a", type: "invoice.settled", raw_body: RAW });
    await until(() => platform.acks.length === 1);
    expect(platform.acks[0]!.body).toMatchObject({ status_code: 500 });
    expect(out.find((l) => l.includes("evt_a"))).toMatch(/→ 500 Internal Server Error/);
    await rx.close();
    platform.emit({ id: "dlv_2", event_id: "evt_b", type: "invoice.settled", raw_body: RAW });
    await until(() => platform.acks.length === 2);
    expect(platform.acks[1]!.body).toMatchObject({ error: "ECONNREFUSED" });
    expect(out.find((l) => l.includes("evt_b"))).toMatch(/→ failed: ECONNREFUSED/);
    ac.abort();
    expect(await done).toEqual({ received: 2, forwarded: 0, failed: 2, skipped: 0 });
  });

  test("--events filters: skipped ones are printed as skipped and acked printed_only; --compact one line; --no-forward", async () => {
    const ac = new AbortController();
    const done = listen(base({ forward: undefined, events: ["subscription.canceled"], compact: true, signal: ac.signal }));
    await until(() => out.some((l) => l.startsWith("Ready.")));
    expect(out.join("\n")).toContain("Ready. Printing only (--no-forward)");
    platform.emit({ id: "dlv_1", event_id: "evt_x", type: "invoice.settled", raw_body: RAW });
    platform.emit({ id: "dlv_2", event_id: "evt_y", type: "subscription.canceled", raw_body: RAW });
    await until(() => platform.acks.length === 2);
    expect(out.find((l) => l.includes("evt_x"))).toMatch(/skipped \(--events\)/);
    expect(platform.acks[0]!.body).toEqual({ printed_only: true, duration_ms: 0, headers: expect.any(Object) });
    const y = out.find((l) => l.includes("evt_y"))!;
    expect(y).toMatch(/printed$/);
    expect(out.filter((l) => l.trim().startsWith("{")).every((l) => !l.includes("\n"))).toBe(true);
    ac.abort();
    expect(await done).toEqual({ received: 2, forwarded: 0, failed: 0, skipped: 1 });
  });

  test("FR-CLI-016 the stream dropping prints a reconnect line and later deliveries still arrive", async () => {
    const ac = new AbortController();
    const done = listen(base({ signal: ac.signal }));
    await until(() => out.some((l) => l.startsWith("Ready.")));
    platform.drop();
    await until(() => err.some((l) => /Connection lost. Reconnecting in 1 s \(attempt 1\)/.test(l)));
    await until(() => platform.requests.filter((r) => r.path.endsWith("/stream")).length === 2);
    await new Promise((r) => setTimeout(r, 30));
    platform.emit({ id: "dlv_9", event_id: "evt_9", type: "invoice.settled", raw_body: RAW });
    await until(() => platform.acks.length === 1);
    ac.abort();
    await done;
  });

  test("BR-CLI-003 live mode needs --live; a bad key exits with the API message", async () => {
    await platform.close();
    platform = await startMockPlatform({ livemode: true });
    await expect(listen(base({}))).rejects.toThrow(/LIVE mode.*--live/);
    expect(err.join("\n")).toContain("LIVE");
    await expect(listen(base({ key: "sk_test_bad" }))).rejects.toThrow(/Invalid API key/);
  });
});
