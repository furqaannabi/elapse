import { createRoute, z } from "@hono/zod-openapi";
import { CursorNotFound, findEvent, listEvents, serializeEvent } from "../db/events";
import { invalid, notFound } from "../lib/errors";
import { EVENT_TYPES } from "../lib/event-types";
import { router } from "../lib/openapi";
import { ListOf, ListQuery, page } from "../lib/pagination";
import { requireKey, type AuthEnv } from "../middleware/auth";

/** Events (FR-API-063): read-only for merchants. Creation happens at ingest and from test actions. */

export const EventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_5Rt8Kq2Mn9Lp3Wx" }),
    object: z.literal("event"),
    type: z.enum(EVENT_TYPES),
    created: z.number().int(),
    livemode: z.boolean(),
    data: z.object({ object: z.record(z.string(), z.unknown()) }),
    pending_webhooks: z.number().int(),
    request: z.object({ id: z.string().nullable(), idempotency_key: z.string().nullable() }).optional(),
  })
  .openapi("Event");

export const events = router<AuthEnv>();
events.use("/events", requireKey(["sk"]));
events.use("/events/*", requireKey(["sk"]));

events.openapi(
  createRoute({
    method: "get",
    path: "/events",
    operationId: "events.list",
    tags: ["Events"],
    request: { query: ListQuery.extend({ type: z.enum(EVENT_TYPES).optional() }) },
    responses: { 200: { description: "Events, newest first.", content: { "application/json": { schema: ListOf(EventSchema, "EventList") } } } },
  }),
  async (c) => {
    const q = c.req.valid("query");
    const auth = c.get("auth");
    try {
      const rows = await listEvents(auth.merchantId, auth.livemode, { limit: q.limit, startingAfter: q.starting_after, type: q.type });
      return c.json(page(rows.map(serializeEvent), q.limit, "/v1/events"), 200);
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
    responses: { 200: { description: "The event.", content: { "application/json": { schema: EventSchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findEvent(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("event", id);
    return c.json(serializeEvent(row), 200);
  },
);
