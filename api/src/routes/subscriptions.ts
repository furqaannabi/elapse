import { createRoute, z } from "@hono/zod-openapi";
import { findSubscription, serializeSubscription } from "../db/subscriptions";
import { RelayerUnavailable } from "../chain/relayer";
import { ApiError, notFound } from "../lib/errors";
import { router } from "../lib/openapi";
import { merchantAuth, type AuthEnv } from "../middleware/auth";
import { CheckoutStateError, cancelAsKeeper } from "../services/checkout";
import { SubscriptionSchema } from "./checkout-sessions";

/**
 * Subscriptions (FR-API-040..042): read with `sk_` or the dashboard cookie; cancel from the
 * merchant's server through the keeper. Status is never set here, it arrives from ingest
 * (BR-API-005). `list` (FR-API-041) follows with the customers/invoices read slice.
 */
export const subscriptions = router<AuthEnv>();
subscriptions.use("/subscriptions", merchantAuth());
subscriptions.use("/subscriptions/*", merchantAuth());

subscriptions.openapi(
  createRoute({
    method: "get",
    path: "/subscriptions/{id}",
    operationId: "subscriptions.retrieve",
    tags: ["Subscriptions"],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: "The subscription.", content: { "application/json": { schema: SubscriptionSchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findSubscription(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("subscription", id);
    return c.json(serializeSubscription(row), 200);
  },
);

subscriptions.openapi(
  createRoute({
    method: "post",
    path: "/subscriptions/{id}/cancel",
    operationId: "subscriptions.cancel",
    tags: ["Subscriptions"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      202: {
        description: "Cancel submitted on chain. The object is unchanged until `subscription.canceled` arrives; `pending_tx` is the relayer's transaction.",
        content: { "application/json": { schema: SubscriptionSchema.extend({ pending_tx: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findSubscription(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("subscription", id);
    try {
      const pendingTx = await cancelAsKeeper(row);
      return c.json({ ...serializeSubscription(row), pending_tx: pendingTx }, 202);
    } catch (e) {
      if (e instanceof CheckoutStateError) throw new ApiError(409, "invalid_request_error", e.message, undefined, e.code);
      if (e instanceof RelayerUnavailable) throw new ApiError(503, "api_error", "Canceling is temporarily unavailable.");
      throw e;
    }
  },
);
