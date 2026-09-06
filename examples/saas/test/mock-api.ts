import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A tiny Elapse API double: records every request, answers products.list/create and checkout.sessions.create. */
export async function mockApi(opts: { existingProducts?: Array<{ id: string; name: string; rate_usd_per_second: string }> } = {}) {
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
      return json(200, { object: "list", data: (opts.existingProducts ?? []).map((p) => ({ object: "product", active: true, ...p })), has_more: false, url: "/v1/products" });
    }
    if (req.method === "POST" && path === "/v1/products") {
      const b = JSON.parse(raw) as { name: string; rate_usd_per_second: string };
      return json(200, { id: `prod_new${++n}`, object: "product", name: b.name, rate_usd_per_second: b.rate_usd_per_second, active: true });
    }
    if (req.method === "POST" && path === "/v1/checkout/sessions") {
      const b = JSON.parse(raw) as { product: string };
      return json(200, { id: `cs_${++n}`, object: "checkout.session", status: "open", url: `https://elapse.finance/c/cs_${n}`, product: { id: b.product } });
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
