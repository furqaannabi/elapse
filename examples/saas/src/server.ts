import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Entitlements } from "./entitlements";
import { handleWebhook } from "./webhooks";

/**
 * FR-EXM-010–012, FR-EXM-020: the merchant's HTTP server on Node's built-in
 * module (examples FRD Undecided 1). Five routes: the fake product page, the
 * success and cancel pages Checkout returns to, the access check, and the
 * webhook receiver. No framework, so the raw body is the default.
 */

export interface ServerDeps {
  entitlements: Entitlements;
  webhookSecret: string;
  log: (line: string) => void;
  logJson?: boolean;
  /** `checkout.sessions.create` behind a function so tests need no API. */
  createSession: () => Promise<{ id: string; url: string }>;
  product: { name: string; rateUsdPerSecond: string };
}

export function createServer(deps: ServerDeps) {
  const sessions = new SessionCache(deps.createSession);
  return createHttpServer((req, res) => {
    route(req, res, deps, sessions).catch((err: Error) => {
      deps.log(`✗ ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) send(res, 500, "text/plain", "Something went wrong.");
    });
  });
}

/** FR-EXM-010: one open session is reused across page loads; a used one is replaced on the next load. */
class SessionCache {
  #current: Promise<{ id: string; url: string }> | undefined;
  constructor(private readonly create: () => Promise<{ id: string; url: string }>) {}
  current() {
    return (this.#current ??= this.create());
  }
  async consume(id: string) {
    if (this.#current && (await this.#current).id === id) this.#current = undefined;
  }
}

/** The merchant's three pages and their one stylesheet (FR-EXM-010/011): plain files under public/, filled with {{vars}}. */
const asset = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const PAGE = asset("index.html");
const OK_PAGE = asset("ok.html");
const CANCEL_PAGE = asset("cancel.html");
const STYLE = asset("acme.css");
const MERCHANT = "Acme GPU";
const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => escape(vars[k] ?? ""));
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const hourly = (rate: string) => (Number(rate) * 3600).toFixed(2); // display only; money math stays on the platform (BR-EXM-006)

async function route(req: IncomingMessage, res: ServerResponse, deps: ServerDeps, sessions: SessionCache): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const vars = { merchant: MERCHANT, product: deps.product.name, price: `$${deps.product.rateUsdPerSecond} / second · ~$${hourly(deps.product.rateUsdPerSecond)} / hour` };
  if (req.method === "GET" && url.pathname === "/") {
    const s = await sessions.current();
    return send(res, 200, "text/html; charset=utf-8", fill(PAGE, { ...vars, checkout_url: s.url }));
  }
  if (req.method === "GET" && url.pathname === "/acme.css") {
    return send(res, 200, "text/css; charset=utf-8", STYLE);
  }
  if (req.method === "GET" && url.pathname === "/ok") {
    const id = url.searchParams.get("session_id") ?? "";
    await sessions.consume(id);
    const e = deps.entitlements.forSession(id);
    const state = e ? `${e.subscription}: ${e.entitled ? "entitled" : `not entitled (${e.reason})`}` : "pending webhook";
    const running = !e || e.entitled; // pending webhook counts as running: the subscriber just started it
    return send(res, 200, "text/html; charset=utf-8", fill(OK_PAGE, { ...vars, session: id, state, led: running ? "on post" : "", status: running ? "Meter running" : "Meter stopped", note: running ? "Your meter is running. Cancel from the checkout page whenever you like; you pay the seconds that elapsed." : "Your meter has stopped. You paid only the seconds that elapsed." }));
  }
  if (req.method === "GET" && url.pathname === "/cancel") {
    return send(res, 200, "text/html; charset=utf-8", fill(CANCEL_PAGE, vars));
  }
  const access = url.pathname.match(/^\/access\/([\w-]+)$/);
  if (req.method === "GET" && access) {
    return send(res, 200, "application/json", JSON.stringify(deps.entitlements.get(access[1] as string)));
  }
  if (req.method === "POST" && url.pathname === "/webhooks") {
    const raw = await readRaw(req);
    const header = req.headers["x-elapse-signature"];
    const out = handleWebhook(raw, Array.isArray(header) ? header[0] : header, { secret: deps.webhookSecret, entitlements: deps.entitlements, log: deps.log, ...(deps.logJson === undefined ? {} : { logJson: deps.logJson }) });
    send(res, out.status, "application/json", out.body);
    if (out.work) setImmediate(out.work);
    return;
  }
  send(res, 404, "text/plain", "Not found");
}

/** The exact bytes the platform signed; never JSON-parse before verifying (BR-SDK-003). */
function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}


function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}
