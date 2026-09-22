import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny Elapse API double: records every request and answers products.list/create,
 * checkout.sessions.create (echoing the session cap), subscriptions.start and subscriptions.cancel.
 */
export async function mockApi(
  opts: {
    existingProducts?: Array<{ id: string; name: string; rate_usd_per_second: string; start_mode?: string }>;
    /** FR-EXM-158: what `subscriptions.list` reports when the server comes up. */
    existingSubscriptions?: Array<{ id: string; product: string; status: string; started_at?: number }>;
  } = {},
) {
  const requests: Array<{ method: string; path: string; auth: string | undefined; body: unknown }> = [];
  let n = 0;
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = req.url ?? "";
    requests.push({ method: req.method ?? "", path, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path.startsWith("/v1/products")) {
      return json(200, { object: "list", data: (opts.existingProducts ?? []).map((p) => ({ object: "product", active: true, start_mode: "checkout", ...p })), has_more: false, url: "/v1/products" });
    }
    if (req.method === "POST" && path === "/v1/products") {
      const b = JSON.parse(raw) as { name: string; rate_usd_per_second: string; start_mode?: string };
      return json(200, { id: `prod_new${++n}`, object: "product", name: b.name, rate_usd_per_second: b.rate_usd_per_second, start_mode: b.start_mode ?? "checkout", active: true });
    }
    if (req.method === "POST" && path === "/v1/checkout/sessions") {
      const b = JSON.parse(raw) as { product: string };
      // No `url`: the hosted checkout is gone; the page authorises in place (FR-API-140, FR-EXM-152).
      return json(200, { id: `cs_${++n}`, object: "checkout.session", status: "open", product: { id: b.product } });
    }
    if (req.method === "GET" && path.startsWith("/v1/subscriptions?")) {
      return json(200, {
        object: "list",
        data: (opts.existingSubscriptions ?? []).map((x) => ({ object: "subscription", ...x })),
        has_more: false,
        url: "/v1/subscriptions",
      });
    }
    const start = path.match(/^\/v1\/subscriptions\/([\w-]+)\/start$/);
    if (req.method === "POST" && start) {
      return json(202, { id: start[1], object: "subscription", status: "incomplete" });
    }
    const cancel = path.match(/^\/v1\/subscriptions\/([\w-]+)\/cancel$/);
    if (req.method === "POST" && cancel) {
      return json(200, { id: cancel[1], object: "subscription", status: "canceled" });
    }
    json(404, { error: { type: "not_found", message: "no route" } });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
