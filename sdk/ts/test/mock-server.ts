import { createServer, type IncomingMessage, type Server } from "node:http";

export interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}
type Handler = (req: Seen, n: number) => { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number };

/** Programmable HTTP server for transport tests. */
export async function startMock() {
  const seen: Seen[] = [];
  let handler: Handler = () => ({ status: 200, body: {} });
  let calls = 0;
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const s: Seen = {
      method: req.method!,
      path: req.url!,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
      body: Buffer.concat(chunks).toString("utf8"),
    };
    seen.push(s);
    const r = handler(s, ++calls);
    if (r.delayMs) await new Promise((f) => setTimeout(f, r.delayMs));
    res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
    res.end(r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  });
  await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    on(h: Handler) {
      handler = h;
      calls = 0;
      seen.length = 0;
    },
    close: () => new Promise<void>((f) => server.close(() => f())),
  };
}
