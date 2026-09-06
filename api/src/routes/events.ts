import { createRoute, z } from "@hono/zod-openapi";
import { CursorNotFound, findEvent, listEvents, serializeEventForRead } from "../db/events";
import { listDeliveriesForEvent, requestEventResend } from "../db/deliveries";
import { serializeDeliverySummary } from "./deliveries";
import { invalid, notFound } from "../lib/errors";
import { WebhookEventSchema } from "../lib/event-schema";
import { EVENT_TYPES } from "../lib/event-types";
import { router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { merchantAuth, type AuthEnv } from "../middleware/auth";

/** Events (FR-API-063): read-only for merchants. Creation happens at ingest and from test actions. */

export const EventSchema = WebhookEventSchema.extend({
    object_id: z.string().nullable().openapi({ description: "`data.object.id`, for tables." }),
    delivery_state: z.enum(["pending", "delivered", "failed"]).openapi({ description: "Rolled up from this event's deliveries." }),
  })
  .openapi("Event");

export const events = router<AuthEnv>();
events.use("/events", merchantAuth());
events.use("/events/*", merchantAuth());

events.openapi(
  createRoute({
    method: "get",
    path: "/events",
    operationId: "events.list",
    tags: ["Events"],
    request: { query: ListQuery.extend({ type: z.enum(EVENT_TYPES).optional(), since: z.coerce.number().int().optional(), until: z.coerce.number().int().optional() }) },
    responses: { 200: { description: "Events, newest first.", content: { "application/json": { schema: ListOf(EventSchema, "EventList") } } } },
  }),
  async (c) => {
    const q = c.req.valid("query");
    const auth = c.get("auth");
    try {
      const rows = await listEvents(auth.merchantId, auth.livemode, { limit: q.limit, startingAfter: q.starting_after, type: q.type, since: q.since, until: q.until });
      return c.json(page(rows.map(serializeEventForRead), q.limit, "/v1/events"), 200);
    } catch (e) {
      if (e instanceof CursorNotFound) throw invalid(e.message, "starting_after");
      throw e;
    }
  },
);

events.openapi(
  createRoute({
    method: "get",
    path: "/events/{id}",
    operationId: "events.retrieve",
    tags: ["Events"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The event, with its deliveries (one per endpoint).", content: { "application/json": { schema: EventSchema.extend({ deliveries: z.array(z.record(z.string(), z.unknown())) }) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findEvent(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("event", id);
    const deliveries = (await listDeliveriesForEvent(row.id)).map(serializeDeliverySummary);
    return c.json({ ...serializeEventForRead(row), deliveries }, 200);
  },
);

events.openapi(
  createRoute({
    method: "post",
    path: "/events/{id}/resend",
    operationId: "events.resend",
    tags: ["Events"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      202: {
        description: "Queued: one freshly signed manual attempt per existing delivery of this event (FR-API-133). A CLI delivery is included only while `elapse listen` is connected.",
        content: { "application/json": { schema: z.object({ object: z.literal("list"), data: z.array(z.record(z.string(), z.unknown())) }) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const rows = await requestEventResend(auth.merchantId, auth.livemode, id, auth.actor);
    if (!rows) throw notFound("event", id);
    return c.json({ object: "list" as const, data: rows.map(serializeDeliverySummary) }, 202);
  },
);
