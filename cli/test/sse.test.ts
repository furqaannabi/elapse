import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { backoffMs, parseSSE, readSSE, type SSEFrame } from "../src/sse";

function chunks(parts: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return (async function* () {
    for (const p of parts) yield enc.encode(p);
  })();
}

describe("SSE parser", () => {
  test("frames split across chunks, multi-line data, id, comments, CRLF", async () => {
    const got: SSEFrame[] = [];
    for await (const f of parseSSE(chunks(["event: heart", "beat\ndata: {\"at\":1}\n\n:ping\n", "event: delivery\r\nid: dlv_1\r\ndata: {\"a\":\r\ndata: 1}\r\n\r\n"]))) got.push(f);
    expect(got).toEqual([
      { event: "heartbeat", data: '{"at":1}' },
      { event: "delivery", id: "dlv_1", data: '{"a":\n1}' },
    ]);
  });

  test("a frame without event is 'message'; an unterminated tail is dropped", async () => {
    const got: SSEFrame[] = [];
    for await (const f of parseSSE(chunks(["data: x\n\ndata: partial"]))) got.push(f);
    expect(got).toEqual([{ event: "message", data: "x" }]);
  });
});

describe("FR-CLI-016 backoff", () => {
  test("1 s doubling to a 30 s cap", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe("readSSE reconnects", () => {
  let server: Server;
  afterEach(() => server?.close());

  test("drops after the first frame, reconnects with Last-Event-ID, and delivers the rest; attempts are reported", async () => {
    let connections = 0;
    const seen: (string | undefined)[] = [];
    server = createServer((req, res) => {
      connections++;
      seen.push(req.headers["last-event-id"] as string | undefined);
      expect(req.headers.authorization).toBe("Bearer sk_test_x");
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (connections === 1) {
        res.write("event: delivery\nid: d1\ndata: {\"n\":1}\n\n");
        setTimeout(() => res.destroy(), 20);
      } else {
        res.write("event: delivery\nid: d2\ndata: {\"n\":2}\n\n");
        res.write("event: delivery\nid: d3\ndata: {\"n\":3}\n\n");
      }
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const frames: SSEFrame[] = [];
    const attempts: number[] = [];
    const ac = new AbortController();
    for await (const f of readSSE(`http://127.0.0.1:${port}/stream`, { key: "sk_test_x", signal: ac.signal, sleep: async () => {}, onReconnect: (n) => attempts.push(n) })) {
      frames.push(f);
      if (frames.length === 3) ac.abort();
    }
    expect(frames.map((f) => f.id)).toEqual(["d1", "d2", "d3"]);
    expect(seen).toEqual([undefined, "d1"]);
    expect(attempts).toEqual([1]);
  });

  test("a 401 on connect throws instead of retrying forever", async () => {
    server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "authentication_error", message: "Invalid API key provided." } }));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const it = readSSE(`http://127.0.0.1:${port}/stream`, { key: "sk_test_bad", sleep: async () => {} });
    await expect(it.next()).rejects.toThrow(/Invalid API key/);
  });
});
