import { z } from "@hono/zod-openapi";
import { EVENT_TYPES } from "./event-types";

/**
 * The signed webhook body (doc §5.3, BR-API-008): what `constructEvent` returns
 * and what the docs catalog validates its six sample payloads against. The
 * dashboard's `GET /v1/events` adds read-only fields on top of this
 * (`object_id`, `delivery_state`); those never appear in a signed body.
 */
export const WebhookEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_5Rt8Kq2Mn9Lp3Wx" }),
    object: z.literal("event"),
    type: z.enum(EVENT_TYPES).openapi({ description: "One of six lifecycle types. There are no per-second events." }),
    created: z.number().int().openapi({ description: "Unix seconds." }),
    livemode: z.boolean(),
    data: z.object({
      object: z.record(z.string(), z.unknown()).openapi({ description: "The Subscription, Invoice, or completed Checkout session the event is about. Subscription totals are cumulative." }),
    }),
    pending_webhooks: z.number().int().openapi({ description: "Endpoints still waiting to acknowledge this event." }),
    request: z.object({ id: z.string().nullable(), idempotency_key: z.string().nullable() }).optional(),
  })
  .openapi("Event", { description: "A signed webhook body. Verify it with `elapse.webhooks.constructEvent` before reading it." });
