import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { listEvents, serializeEventForRead } from "../db/events";
import { overview, serializeSubscription } from "../db/subscriptions";
import { baseUnitsToDecimal } from "../lib/money";
import { router } from "../lib/openapi";
import { sessionAuth, type AuthEnv } from "../middleware/auth";
import { SubscriptionSchema } from "./checkout-sessions";
import { EventSchema } from "./events";

/**
 * `GET /v1/dashboard/overview` (dashboard FR-DSH-021..023): the four Home tiles, up to ten
 * running meters, and the ten most recent events, in one call. Cookie only.
 * `accrued_today_usd` is what active meters have run up since midnight UTC or their start,
 * whichever is later, at their rate; the meter tiles then tick forward client-side.
 */
const OverviewSchema = z
  .object({
    running_now: z.number().int(),
    accrued_today_usd: z.string(),
    settled_week_net_usd: z.string(),
    failed_payments_week: z.number().int(),
    running: z.array(SubscriptionSchema),
    recent_events: z.array(EventSchema),
    as_of: z.number().int(),
  })
  .openapi("DashboardOverview");

export const dashboardOverview = router<AuthEnv>();
dashboardOverview.use("/dashboard/overview", sessionAuth());

dashboardOverview.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/overview",
    operationId: "dashboard.overview",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "Home tiles, running meters, recent events.", content: { "application/json": { schema: OverviewSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const now = new Date();
    const o = await overview(auth.merchantId, auth.livemode, now);
    const events = await listEvents(auth.merchantId, auth.livemode, { limit: 10 });
    const d = config.tokenDecimals;
    return c.json(
      {
        running_now: o.running_now,
        accrued_today_usd: baseUnitsToDecimal(o.accrued_today_wei, d),
        settled_week_net_usd: baseUnitsToDecimal(o.settled_week_net_wei, d),
        failed_payments_week: o.failed_payments_week,
        running: o.running.map((s) => serializeSubscription(s, Math.floor(now.getTime() / 1000))),
        recent_events: events.slice(0, 10).map(serializeEventForRead),
        as_of: Math.floor(now.getTime() / 1000),
      },
      200,
    );
  },
);
