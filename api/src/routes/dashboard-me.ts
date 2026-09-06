import { createRoute, z } from "@hono/zod-openapi";
import { sql } from "../db/client";
import { checklist, getMerchantProfile, serializeProfile } from "../db/merchant-profile";
import { invalid, notFound } from "../lib/errors";
import { router } from "../lib/openapi";
import { clientIp, sessionAuth, type AuthEnv } from "../middleware/auth";

/**
 * `GET/POST /v1/dashboard/me` (FR-API-103; dashboard FR-DSH-013, FR-DSH-100..102). Cookie only.
 * The first POST that carries `name` completes first-run; `payout_address` here is the
 * first-run capture, later changes go through FR-API-106 with a re-typed confirmation.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const ProfileSchema = z
  .object({
    id: z.string(),
    object: z.literal("merchant"),
    name: z.string().nullable(),
    email: z.string(),
    support_email: z.string().nullable(),
    support_url: z.string().nullable(),
    payout_address: z.string().nullable(),
    fee_bps: z.number().int(),
    branding: z.object({ display_name: z.string().nullable(), logo_url: z.string().nullable(), accent: z.string().nullable(), support_url: z.string().nullable() }),
    notifications: z.object({ endpoint_exhausted_email: z.boolean(), key_expiry_email: z.boolean() }),
    checklist: z.object({ key_created: z.boolean(), product_created: z.boolean(), endpoint_created: z.boolean(), first_delivery_succeeded: z.boolean() }),
    created: z.number().int(),
  })
  .openapi("MerchantProfile");

const UpdateBody = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    payout_address: z.string().regex(ADDRESS, "must be a 0x-prefixed 20-byte address").optional(),
    support_email: z.string().email().max(254).nullable().optional(),
    support_url: z.string().url().max(2048).nullable().optional(),
    branding: z
      .strictObject({
        display_name: z.string().trim().max(80).nullable().optional(),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb colour").nullable().optional(),
        support_url: z.string().url().max(2048).nullable().optional(),
      })
      .optional(),
    notifications: z.strictObject({ endpoint_exhausted_email: z.boolean().optional(), key_expiry_email: z.boolean().optional() }).optional(),
  })
  .openapi("UpdateMerchantProfile");

export const dashboardMe = router<AuthEnv>();
dashboardMe.use("/dashboard/me", sessionAuth());

dashboardMe.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/me",
    operationId: "dashboard.me",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "The signed-in merchant.", content: { "application/json": { schema: ProfileSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const m = await getMerchantProfile(auth.merchantId);
    if (!m) throw notFound("merchant");
    return c.json(serializeProfile(m, auth.livemode, await checklist(auth.merchantId, auth.livemode)), 200);
  },
);

dashboardMe.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/me",
    operationId: "dashboard.me.update",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
    responses: { 200: { description: "The updated merchant.", content: { "application/json": { schema: ProfileSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const b = c.req.valid("json");
    const ip = clientIp(c);
    const m = await getMerchantProfile(auth.merchantId);
    if (!m) throw notFound("merchant");
    if (!m.onboarded_at && !b.name) throw invalid("Set a business name to finish setting up.", "name");

    await sql.begin(async (tx) => {
      const audit = (action: string, target: string | null) =>
        tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${auth.merchantId}, 'dashboard', ${action}, ${target}, ${ip})`;
      if (b.name !== undefined) {
        await tx`UPDATE merchants SET name = ${b.name} WHERE id = ${auth.merchantId}`;
        if (!m.onboarded_at) {
          await tx`UPDATE merchants SET onboarded_at = now() WHERE id = ${auth.merchantId}`;
          await audit("merchant.onboarded", null);
        } else await audit("merchant.updated", "name");
      }
      if (b.payout_address !== undefined) {
        await tx`UPDATE merchants SET payout_address = ${b.payout_address.toLowerCase()} WHERE id = ${auth.merchantId}`;
        await audit("payout_address_changed", b.payout_address.toLowerCase());
      }
      if (b.support_email !== undefined) await tx`UPDATE merchants SET support_email = ${b.support_email} WHERE id = ${auth.merchantId}`;
      if (b.support_url !== undefined) await tx`UPDATE merchants SET support_url = ${b.support_url} WHERE id = ${auth.merchantId}`;
      if (b.branding) {
        const next = { ...m.branding, ...b.branding };
        await tx`UPDATE merchants SET branding = ${next} WHERE id = ${auth.merchantId}`;
        await audit("merchant.updated", "branding");
      }
      if (b.notifications?.endpoint_exhausted_email !== undefined) await tx`UPDATE merchants SET notify_endpoint_exhausted = ${b.notifications.endpoint_exhausted_email} WHERE id = ${auth.merchantId}`;
      if (b.notifications?.key_expiry_email !== undefined) await tx`UPDATE merchants SET notify_key_expiry = ${b.notifications.key_expiry_email} WHERE id = ${auth.merchantId}`;
    });
    const after = (await getMerchantProfile(auth.merchantId))!;
    return c.json(serializeProfile(after, auth.livemode, await checklist(auth.merchantId, auth.livemode)), 200);
  },
);
