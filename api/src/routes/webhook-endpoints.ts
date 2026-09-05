import { createRoute, z } from "@hono/zod-openapi";
import {
  CursorNotFound,
  deleteWebhookEndpoint,
  findWebhookEndpoint,
  insertWebhookEndpoint,
  listWebhookEndpoints,
  rollWebhookSecret,
  updateWebhookEndpoint,
  type WebhookEndpointRow,
} from "../db/webhook-endpoints";
import { createEvent } from "../db/events";
import { invalid, notFound } from "../lib/errors";
import { EVENT_TYPES } from "../lib/event-types";
import { router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { sampleObject } from "../lib/sample-objects";
import { webhookUrlProblem } from "../lib/url-safety";
import { EventSchema } from "./events";
import { requireKey, type AuthEnv } from "../middleware/auth";

/**
 * Webhook endpoints (FR-API-060, 061, 062, 105). Secret returned once on
 * create and roll, stored encrypted, never read back (BR-API-003).
 * `POST …/test` enqueues a synthetic Event for that one endpoint (FR-API-061).
 */

const EventsField = z
  .array(z.string())
  .min(1)
  .superRefine((arr, ctx) => {
    if (arr.includes("*")) {
      if (arr.length !== 1) ctx.addIssue({ code: "custom", message: '"*" must be the only entry' });
      return;
    }
    const bad = arr.find((t) => !(EVENT_TYPES as readonly string[]).includes(t));
    if (bad) ctx.addIssue({ code: "custom", message: `unknown event type "${bad}"` });
  })
  .openapi({ example: ["subscription.canceled", "invoice.settled"], description: 'Subset of the six event types, or ["*"].' });

export const WebhookEndpointSchema = z
  .object({
    id: z.string().openapi({ example: "wh_7Hq2LmN8pR4sTv" }),
    object: z.literal("webhook_endpoint"),
    url: z.string(),
    events: z.array(z.string()),
    disabled: z.boolean(),
    livemode: z.boolean(),
    created: z.number().int(),
    previous_secret_expires_at: z.number().int().nullable().openapi({ description: "While set, the previous secret also signs (roll grace)." }),
    secret: z.string().optional().openapi({ description: "Only on create and roll_secret. Store it; it is never shown again." }),
  })
  .openapi("WebhookEndpoint");

const CreateBody = z.strictObject({ url: z.string(), events: EventsField }).openapi("CreateWebhookEndpoint");
const UpdateBody = z
  .strictObject({ url: z.string().optional(), events: EventsField.optional(), disabled: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update." })
  .openapi("UpdateWebhookEndpoint");
const RollBody = z
  .strictObject({
    grace: z.union([z.literal(0), z.literal(3600), z.literal(86400)]).openapi({ description: "Seconds the old secret keeps signing: 0, 3600 or 86400." }),
  })
  .openapi("RollWebhookSecret");
const IdParam = z.object({ id: z.string() });

export function serializeEndpoint(e: WebhookEndpointRow, secret?: string) {
  return {
    id: e.id,
    object: "webhook_endpoint" as const,
    url: e.url,
    events: e.events,
    disabled: e.disabled,
    livemode: e.livemode,
    created: Math.floor(e.created_at.getTime() / 1000),
    previous_secret_expires_at: e.previous_secret_expires_at ? Math.floor(e.previous_secret_expires_at.getTime() / 1000) : null,
    ...(secret ? { secret } : {}),
  };
}

async function assertUrl(url: string, livemode: boolean) {
  const problem = await webhookUrlProblem(url, livemode);
  if (problem) throw invalid(`Invalid url: ${problem}`, "url");
}

export const webhookEndpoints = router<AuthEnv>();
webhookEndpoints.use("/webhook_endpoints", requireKey(["sk"]));
webhookEndpoints.use("/webhook_endpoints/*", requireKey(["sk"]));

const ok = (schema: z.ZodTypeAny, description: string) => ({ 200: { description, content: { "application/json": { schema } } } });

webhookEndpoints.openapi(
  createRoute({
    method: "post",
    path: "/webhook_endpoints",
    operationId: "webhookEndpoints.create",
    tags: ["Webhooks"],
    request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
    responses: ok(WebhookEndpointSchema, "The endpoint, with its signing secret shown once."),
  }),
  async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    await assertUrl(body.url, auth.livemode);
    const { row, secret } = await insertWebhookEndpoint({ merchantId: auth.merchantId, livemode: auth.livemode, url: body.url, events: body.events, actor: auth.actor });
    return c.json(serializeEndpoint(row, secret), 200);
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "get",
    path: "/webhook_endpoints",
    operationId: "webhookEndpoints.list",
    tags: ["Webhooks"],
    request: { query: ListQuery },
    responses: ok(ListOf(WebhookEndpointSchema, "WebhookEndpointList"), "Endpoints, newest first."),
  }),
  async (c) => {
    const q = c.req.valid("query");
    const auth = c.get("auth");
    try {
      const rows = await listWebhookEndpoints(auth.merchantId, auth.livemode, { limit: q.limit, startingAfter: q.starting_after });
      return c.json(page(rows.map((r) => serializeEndpoint(r)), q.limit, "/v1/webhook_endpoints"), 200);
    } catch (e) {
      if (e instanceof CursorNotFound) throw invalid(e.message, "starting_after");
      throw e;
    }
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "get",
    path: "/webhook_endpoints/{id}",
    operationId: "webhookEndpoints.retrieve",
    tags: ["Webhooks"],
    request: { params: IdParam },
    responses: ok(WebhookEndpointSchema, "The endpoint, without its secret."),
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findWebhookEndpoint(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("webhook endpoint", id);
    return c.json(serializeEndpoint(row), 200);
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "post",
    path: "/webhook_endpoints/{id}",
    operationId: "webhookEndpoints.update",
    tags: ["Webhooks"],
    request: { params: IdParam, body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
    responses: ok(WebhookEndpointSchema, "The updated endpoint."),
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    if (body.url !== undefined) await assertUrl(body.url, auth.livemode);
    const row = await updateWebhookEndpoint(auth.merchantId, auth.livemode, id, body, auth.actor);
    if (!row) throw notFound("webhook endpoint", id);
    return c.json(serializeEndpoint(row), 200);
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "delete",
    path: "/webhook_endpoints/{id}",
    operationId: "webhookEndpoints.del",
    tags: ["Webhooks"],
    request: { params: IdParam },
    responses: ok(z.object({ id: z.string(), object: z.literal("webhook_endpoint"), deleted: z.literal(true) }).openapi("DeletedWebhookEndpoint"), "Deleted."),
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const done = await deleteWebhookEndpoint(auth.merchantId, auth.livemode, id, auth.actor);
    if (!done) throw notFound("webhook endpoint", id);
    return c.json({ id, object: "webhook_endpoint" as const, deleted: true as const }, 200);
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "post",
    path: "/webhook_endpoints/{id}/roll_secret",
    operationId: "webhookEndpoints.rollSecret",
    tags: ["Webhooks"],
    request: { params: IdParam, body: { content: { "application/json": { schema: RollBody } }, required: true } },
    responses: ok(WebhookEndpointSchema, "The endpoint with its new secret, shown once."),
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { grace } = c.req.valid("json");
    const auth = c.get("auth");
    const result = await rollWebhookSecret(auth.merchantId, auth.livemode, id, grace, auth.actor);
    if (!result) throw notFound("webhook endpoint", id);
    return c.json(serializeEndpoint(result.row, result.secret), 200);
  },
);

webhookEndpoints.openapi(
  createRoute({
    method: "post",
    path: "/webhook_endpoints/{id}/test",
    operationId: "webhookEndpoints.test",
    tags: ["Webhooks"],
    request: {
      params: IdParam,
      body: { content: { "application/json": { schema: z.strictObject({ type: z.enum(EVENT_TYPES) }).openapi("TestWebhookEndpoint") } }, required: true },
    },
    responses: ok(EventSchema, "The synthetic event; the worker delivers it to this endpoint only."),
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { type } = c.req.valid("json");
    const auth = c.get("auth");
    const ep = await findWebhookEndpoint(auth.merchantId, auth.livemode, id);
    if (!ep) throw notFound("webhook endpoint", id);
    const event = await createEvent({
      merchantId: auth.merchantId,
      livemode: auth.livemode,
      type,
      object: sampleObject(type, auth.livemode),
      onlyEndpointId: ep.id,
      request: { id: null, idempotency_key: null },
    });
    return c.json(event, 200);
  },
);
