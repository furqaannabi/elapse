import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { checkoutOrigin } from "./middleware/auth";
import { config } from "./config";
import { ApiError } from "./lib/errors";
import { router } from "./lib/openapi";
import { account } from "./routes/account";
import { apiKeys } from "./routes/api-keys";
import { checkoutSessions } from "./routes/checkout-sessions";
import { customers } from "./routes/customers";
import { invoices } from "./routes/invoices";
import { dashboardAuth } from "./routes/dashboard-auth";
import { dashboardMe } from "./routes/dashboard-me";
import { dashboardLogo } from "./routes/dashboard-logo";
import { dashboardOverview } from "./routes/dashboard-overview";
import { dashboardOps } from "./routes/dashboard-ops";
import { deliveries } from "./routes/deliveries";
import { events } from "./routes/events";
import { internal } from "./routes/internal";
import { products } from "./routes/products";
import { status } from "./routes/status";
import { subscriptions } from "./routes/subscriptions";
import { webhookEndpoints } from "./routes/webhook-endpoints";
import { cliSessions } from "./routes/cli-sessions";

/**
 * The platform API. One Hono app; routers mount under `/v1`. Errors of every
 * origin leave in the FR-API-082 shape. OpenAPI is served from the same
 * route schemas (FR-API-084).
 */
export const app = router();

// Two browser clients: the hosted checkout (session id as the pass, decided 2026-09-05) and the
// dashboard (HttpOnly cookie, so credentials must be allowed). Each origin is allowed only what it uses.
const checkoutCors = cors({ origin: (o) => (o === checkoutOrigin() ? o : null), allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type", "authorization", "x-privy-token"], maxAge: 600 });
const dashboardCors = cors({
  origin: (o) => (o === config.dashboardOrigin ? o : null),
  credentials: true,
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  // Superset of the checkout rule: a shared dev origin (both on localhost:3000) is answered by this one.
  allowHeaders: ["content-type", "authorization", "x-elapse-mode", "idempotency-key", "x-privy-token"],
  maxAge: 600,
});
// The docs reference's try-it panel (FR-API-086): a test key from the browser is fine; a live key is not.
const docsCors = cors({ origin: (o) => (config.docsOrigin && o === config.docsOrigin ? o : null), allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type", "authorization", "idempotency-key"], maxAge: 600 });
// FR-API-140(c): `@elapse/react` reads the public session from the merchant's own page, on any origin.
// Only that read: no credentials, GET only, and the publishable key still authenticates it. Every
// mutation happens in the Elapse popup on Elapse's origin, so no other route answers a foreign origin.
const publicSessionReadCors = cors({ origin: (o) => o, allowMethods: ["GET", "OPTIONS"], allowHeaders: ["authorization"], maxAge: 600 });
const PUBLIC_SESSION_READ = /^\/v1\/checkout\/sessions\/cs_[A-Za-z0-9]+$/;
app.use("/v1/*", async (c, next) => {
  const origin = c.req.header("origin");
  // The dashboard policy is a superset, so a shared dev origin (both on localhost:3000) still works.
  if (origin && origin === config.dashboardOrigin) return dashboardCors(c, next);
  if (origin && config.docsOrigin && origin === config.docsOrigin) {
    // Inside the CORS middleware, so the refusal carries the headers the browser needs to show it.
    return docsCors(c, async () => {
      if (/^bearer\s+sk_live_/i.test(c.req.header("authorization") ?? "")) {
        throw new ApiError(401, "authentication_error", "Live keys cannot be used from a browser.", undefined, "live_key_in_browser");
      }
      await next();
    });
  }
  if (origin && origin !== checkoutOrigin() && PUBLIC_SESSION_READ.test(c.req.path)) {
    const method = c.req.method === "OPTIONS" ? c.req.header("access-control-request-method") : c.req.method;
    if (method === "GET") return publicSessionReadCors(c, next);
  }
  if (c.req.path.startsWith("/v1/checkout/sessions") || c.req.path.startsWith("/v1/account") || c.req.path === "/v1/status") return checkoutCors(c, next);
  return next();
});

app.route("/v1", products);
app.route("/v1", checkoutSessions);
app.route("/v1", account);
app.route("/v1", subscriptions);
app.route("/v1", customers);
app.route("/v1", invoices);
app.route("/v1", status);
app.route("/v1", webhookEndpoints);
app.route("/v1", events);
app.route("/v1", deliveries);
app.route("/v1", cliSessions);
app.route("/v1", dashboardAuth);
app.route("/v1", dashboardMe);
app.route("/v1", dashboardLogo);
app.route("/v1", dashboardOverview);
app.route("/v1", dashboardOps);
app.route("/v1", apiKeys);

// /internal/* takes only the platform ingest token (FR-API-070); a cookie or merchant key is refused.
app.route("/", internal);

app.notFound((c) =>
  c.json(new ApiError(404, "not_found", `Unrecognized request URL (${c.req.method}: ${c.req.path}).`).toBody(), 404),
);

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(err.toBody(), err.status);
  if (err instanceof HTTPException) {
    // Hono raises these for malformed JSON bodies and the like.
    const type = err.status === 401 ? "authentication_error" : err.status >= 500 ? "api_error" : "invalid_request_error";
    return c.json(new ApiError(err.status, type, err.message || "Invalid request.").toBody(), err.status);
  }
  console.error("unhandled", { path: c.req.path, name: err.name, message: err.message });
  return c.json(new ApiError(500, "api_error", "Something went wrong on our side.").toBody(), 500);
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Elapse API", version: "2026-09-05" },
  servers: [{ url: "/" }],
});
