import { MAX_ATTEMPTS } from "../worker/schedule";
import { createRoute, z } from "@hono/zod-openapi";
import { CursorNotFound, EndpointDisabled, findDelivery, listAttempts, listDeliveriesForEndpoint, requestResend, type AttemptRow, type DeliveryRow } from "../db/deliveries";
import { findWebhookEndpoint } from "../db/webhook-endpoints";
import { invalid, notFound } from "../lib/errors";
import { router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { merchantAuth, type AuthEnv } from "../middleware/auth";

/** Deliveries (FR-API-064; worker FR-WRK-030/031): the dashboard's delivery log and Resend. */

const unix = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);

const AttemptSchema = z.object({
  n: z.number().int(),
  manual: z.boolean(),
  actor: z.string().nullable(),
  sent_at: z.number().int(),
  duration_ms: z.number().int().nullable(),
  status_code: z.number().int().nullable(),
  error: z.string().nullable(),
  request_headers: z.record(z.string(), z.string()),
  response_excerpt: z.string().nullable(),
});

const DeliveryBase = z.object({
  id: z.string().openapi({ example: "dlv_4Kp7Qm2Rn8Tv1Xz" }),
  object: z.literal("delivery"),
  event: z.string(),
  endpoint: z.string(),
  status: z.enum(["queued", "retrying", "succeeded", "exhausted", "skipped"]),
  attempt: z.number().int(),
  next_attempt_at: z.number().int().nullable(),
  livemode: z.boolean(),
  created: z.number().int(),
  resend_requested: z.boolean(),
  endpoint_disabled: z.boolean().openapi({ description: "A disabled endpoint receives nothing, Resend included." }),
  attempts_made: z.number().int().openapi({ description: "Every attempt, automatic and manual. `attempt` counts automatic ones only." }),
});
export const DeliverySummarySchema = DeliveryBase.extend({ last_attempt: AttemptSchema.nullable() }).openapi("DeliverySummary");
export const DeliverySchema = DeliveryBase.extend({ attempts: z.array(AttemptSchema) }).openapi("Delivery");

function serializeAttempt(a: AttemptRow) {
  return { ...a, sent_at: unix(a.sent_at) };
}

function base(d: DeliveryRow) {
  return {
    id: d.id,
    object: "delivery" as const,
    event: d.event_id,
    endpoint: d.endpoint_id,
    status: d.status,
    attempt: d.attempt,
    next_attempt_at: d.status === "queued" || d.status === "retrying" ? unix(d.next_attempt_at) : null,
    livemode: d.livemode,
    created: unix(d.created_at),
    resend_requested: d.manual_requested_at !== null,
    max_attempts: MAX_ATTEMPTS,
    event_type: d.event_type,
    event_created: unix(d.event_created),
    endpoint_url: d.endpoint_url,
    endpoint_disabled: d.endpoint_disabled,
    attempts_made: d.attempts_made,
  };
}

export const serializeDeliverySummary = (d: DeliveryRow) => ({ ...base(d), last_attempt: d.last_attempt ? serializeAttempt(d.last_attempt) : null });
export const serializeDelivery = (d: DeliveryRow, attempts: AttemptRow[]) => ({ ...base(d), attempts: attempts.map(serializeAttempt) });

export const deliveries = router<AuthEnv>();
for (const p of ["/deliveries", "/deliveries/*", "/webhook_endpoints/*/deliveries"]) deliveries.use(p, merchantAuth());

deliveries.openapi(
  createRoute({
    method: "get",
    path: "/webhook_endpoints/{id}/deliveries",
    operationId: "webhookEndpoints.deliveries",
    tags: ["Webhooks"],
    request: { params: z.object({ id: z.string() }), query: ListQuery.extend({ event: z.string().optional(), status: z.enum(["queued", "retrying", "succeeded", "exhausted", "skipped"]).optional() }) },
    responses: { 200: { description: "Deliveries to this endpoint, newest first.", content: { "application/json": { schema: ListOf(DeliverySummarySchema, "DeliveryList") } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const auth = c.get("auth");
    if (!(await findWebhookEndpoint(auth.merchantId, auth.livemode, id))) throw notFound("webhook endpoint", id);
    try {
      const rows = await listDeliveriesForEndpoint(auth.merchantId, auth.livemode, id, { limit: q.limit, startingAfter: q.starting_after, eventId: q.event, status: q.status });
      return c.json(page(rows.map(serializeDeliverySummary), q.limit, `/v1/webhook_endpoints/${id}/deliveries`), 200);
    } catch (e) {
      if (e instanceof CursorNotFound) throw invalid(e.message, "starting_after");
      throw e;
    }
  },
);

deliveries.openapi(
  createRoute({
    method: "get",
    path: "/deliveries/{id}",
    operationId: "deliveries.retrieve",
    tags: ["Webhooks"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The delivery with every attempt.", content: { "application/json": { schema: DeliverySchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const d = await findDelivery(auth.merchantId, auth.livemode, id);
    if (!d) throw notFound("delivery", id);
    return c.json(serializeDelivery(d, await listAttempts(d.id)), 200);
  },
);

deliveries.openapi(
  createRoute({
    method: "post",
    path: "/deliveries/{id}/resend",
    operationId: "deliveries.resend",
    tags: ["Webhooks"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 202: { description: "Queued: the worker sends one freshly signed manual attempt. Status and schedule are unchanged.", content: { "application/json": { schema: DeliverySummarySchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    let d: DeliveryRow | null;
    try {
      d = await requestResend(auth.merchantId, auth.livemode, id, auth.actor);
    } catch (e) {
      if (e instanceof EndpointDisabled) throw invalid(e.message, "id");
      throw e;
    }
    if (!d) throw notFound("delivery", id);
    return c.json(serializeDeliverySummary(d), 202);
  },
);
