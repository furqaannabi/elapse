import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** A fake Elapse platform for the CLI tests: sessions, one SSE stream, acks, events list/resend, products, checkout. */
export interface MockPlatform {
  url: string;
  acks: { delivery: string; body: any }[];
  requests: { method: string; path: string; body: any; headers: IncomingMessage["headers"] }[];
  /** Push a delivery frame to the open stream. */
  emit(frame: { id: string; event_id: string; type: string; raw_body: string; manual?: true }): void;
  /** Sever the open stream. */
  drop(): void;
  livemode: boolean;
  close(): Promise<void>;
}

export async function startMockPlatform(o: { livemode?: boolean; secret?: string } = {}): Promise<MockPlatform> {
  let stream: ServerResponse | null = null;
  const secret = o.secret ?? "whsec_mock000000000000000000000000000";
  const m: MockPlatform = { url: "", acks: [], requests: [], livemode: o.livemode ?? false, emit, drop, close };
  function emit(frame: { id: string; event_id: string; type: string; raw_body: string; manual?: true }) {
    const t = Math.floor(Date.now() / 1000);
    const data = { ...frame, created: t, headers: { "Content-Type": "application/json", "X-Elapse-Signature": `t=${t},v1=${"ab".repeat(32)}`, "X-Elapse-Delivery": frame.id } };
    stream?.write(`event: delivery\nid: ${frame.id}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function drop() {
    stream?.destroy();
    stream = null;
  }
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : null;
    const path = req.url ?? "";
    m.requests.push({ method: req.method ?? "", path, body, headers: req.headers });
    const auth = req.headers.authorization ?? "";
    const json = (status: number, b: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (!auth.startsWith("Bearer sk_")) return json(401, { error: { type: "authentication_error", message: "Invalid API key provided." } });
    if (auth === "Bearer sk_test_bad") return json(401, { error: { type: "authentication_error", message: "Invalid API key provided." } });
    if (req.method === "POST" && path === "/v1/cli/sessions") {
      return json(200, { id: "clis_mock1", object: "cli_session", endpoint_id: "wh_cli1", signing_secret: secret, stream_url: "/v1/cli/sessions/clis_mock1/stream", livemode: m.livemode, merchant_name: "Acme GPU" });
    }
    if (req.method === "GET" && path === "/v1/cli/sessions/clis_mock1/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: heartbeat\ndata: {"at":${Math.floor(Date.now() / 1000)}}\n\n`);
      stream = res;
      return;
    }
    const ack = path.match(/^\/v1\/cli\/sessions\/clis_mock1\/deliveries\/([^/]+)\/ack$/);
    if (req.method === "POST" && ack) {
      m.acks.push({ delivery: ack[1]!, body });
      return json(200, { id: ack[1], object: "delivery", status: body.status_code && body.status_code < 300 ? "succeeded" : "exhausted" });
    }
    if (req.method === "GET" && path.startsWith("/v1/products")) return json(200, { object: "list", data: [], has_more: false });
    if (req.method === "POST" && path === "/v1/products") return json(200, { id: "prod_mock1", object: "product", ...body });
    if (req.method === "POST" && path === "/v1/checkout/sessions") return json(200, { id: "cs_mock1", object: "checkout.session", url: "https://checkout.elapse.dev/c/cs_mock1", ...body });
    if (req.method === "GET" && path.startsWith("/v1/events")) {
      return json(200, { object: "list", has_more: false, data: [
        { id: "evt_1", object: "event", type: "subscription.created", created: 1756800000, livemode: false, pending_webhooks: 0, data: { object: {} } },
        { id: "evt_2", object: "event", type: "subscription.canceled", created: 1756800083, livemode: false, pending_webhooks: 1, data: { object: {} } },
      ] });
    }
    const resend = path.match(/^\/v1\/events\/([^/]+)\/resend$/);
    if (req.method === "POST" && resend) {
      if (resend[1] === "evt_nope") return json(404, { error: { type: "not_found", message: "No such event: 'evt_nope'" } });
      return json(202, { object: "list", data: [{ id: "dlv_r1", object: "delivery", status: "succeeded", endpoint: "wh_1", endpoint_url: "https://acme.test/hooks", resend_requested: true }, { id: "dlv_r2", object: "delivery", status: "queued", endpoint: "wh_cli1", endpoint_url: "cli://", resend_requested: true }] });
    }
    json(404, { error: { type: "not_found", message: `No route ${req.method} ${path}` } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  m.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function close() {
    drop();
    await new Promise<void>((r) => server.close(() => r()));
  }
  return m;
}

/** A merchant's local webhook receiver that records exact bytes and answers with `status`. */
export async function startReceiver(status = 200, delayMs = 0): Promise<{ url: string; received: { body: string; headers: IncomingMessage["headers"] }[]; close(): Promise<void>; setStatus(s: number): void }> {
  let current = status;
  const received: { body: string; headers: IncomingMessage["headers"] }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    received.push({ body: Buffer.concat(chunks).toString("utf8"), headers: req.headers });
    setTimeout(() => {
      res.writeHead(current, { "content-type": "text/plain" });
      res.end(current >= 500 ? "boom" : "ok");
    }, delayMs);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks`,
    received,
    setStatus: (s) => { current = s; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
