import { HTTPException } from "hono/http-exception";
import { ApiError } from "./lib/errors";
import { router } from "./lib/openapi";
import { apiKeys } from "./routes/api-keys";
import { checkoutSessions } from "./routes/checkout-sessions";
import { dashboardAuth } from "./routes/dashboard-auth";
import { deliveries } from "./routes/deliveries";
import { events } from "./routes/events";
import { internal } from "./routes/internal";
import { products } from "./routes/products";
import { subscriptions } from "./routes/subscriptions";
import { webhookEndpoints } from "./routes/webhook-endpoints";

/**
 * The platform API. One Hono app; routers mount under `/v1`. Errors of every
 * origin leave in the FR-API-082 shape. OpenAPI is served from the same
 * route schemas (FR-API-084).
 */
export const app = router();

app.route("/v1", products);
app.route("/v1", checkoutSessions);
app.route("/v1", subscriptions);
app.route("/v1", webhookEndpoints);
app.route("/v1", events);
app.route("/v1", deliveries);
app.route("/v1", dashboardAuth);
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
