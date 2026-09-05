import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config";
import { createApiKey } from "../db/api-keys";
import { consumeMagicLink, issueMagicLink, MagicLinkRateLimited } from "../db/magic-links";
import { createMerchant, findMerchantByEmail, type Merchant } from "../db/merchants";
import { createSession, deleteSession, SESSION_IDLE_DAYS } from "../db/sessions";
import { sql } from "../db/client";
import { ApiError, unauthorized } from "../lib/errors";
import { sendEmail } from "../lib/email";
import { router } from "../lib/openapi";
import { clientIp, SESSION_COOKIE } from "../middleware/auth";

/**
 * Dashboard sign-in (FR-API-100, FR-API-101): email magic link → session
 * cookie. Not part of the public OpenAPI surface (FR-API-102); the routes are
 * still declared with schemas for validation.
 */

const MerchantSchema = z
  .object({ id: z.string(), object: z.literal("merchant"), name: z.string(), email: z.string(), created: z.number().int() })
  .openapi("Merchant");

export function serializeMerchant(m: Merchant) {
  return { id: m.id, object: "merchant" as const, name: m.name, email: m.email, created: Math.floor(m.created_at.getTime() / 1000) };
}

export const dashboardAuth = router();

dashboardAuth.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/auth/magic_link",
    operationId: "dashboard.auth.magicLink",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ email: z.email().max(254) }) } }, required: true } },
    responses: { 200: { description: "Always sent:true (no account enumeration).", content: { "application/json": { schema: z.object({ sent: z.literal(true) }) } } } },
  }),
  async (c) => {
    const email = c.req.valid("json").email.toLowerCase();
    let token: string;
    try {
      token = await issueMagicLink(email, clientIp(c));
    } catch (e) {
      if (e instanceof MagicLinkRateLimited) {
        c.header("Retry-After", String(e.retryAfterSeconds));
        throw new ApiError(429, "rate_limit_error", e.message);
      }
      throw e;
    }
    const link = `${config.dashboardOrigin}/login/verify?token=${token}`;
    await sendEmail({
      to: email,
      subject: "Sign in to Elapse",
      text: `Sign in to your Elapse dashboard:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you did not request it, ignore this email.`,
      html: `<p>Sign in to your Elapse dashboard:</p><p><a href="${link}">${link}</a></p><p>This link works once and expires in 15 minutes. If you did not request it, ignore this email.</p>`,
    });
    return c.json({ sent: true as const }, 200);
  },
);

dashboardAuth.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/auth/verify",
    operationId: "dashboard.auth.verify",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ token: z.string().min(1).max(256) }) } }, required: true } },
    responses: { 200: { description: "Signed in; the session cookie is set.", content: { "application/json": { schema: MerchantSchema } } } },
  }),
  async (c) => {
    const { token } = c.req.valid("json");
    const email = await consumeMagicLink(token);
    if (!email) throw unauthorized("This sign-in link is invalid or has expired.");
    const ip = clientIp(c);
    let merchant = await findMerchantByEmail(email);
    if (!merchant) {
      // First sign-in creates the account with a publishable key per mode (FR-API-002).
      merchant = await createMerchant({ name: email.split("@")[0]!, email });
      for (const livemode of [false, true]) {
        await createApiKey({ merchantId: merchant.id, kind: "pk", livemode, name: "default", actor: "dashboard", ...(ip ? { ip } : {}) });
      }
    }
    const session = await createSession(merchant.id, ip);
    await sql`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${merchant.id}, 'dashboard', 'sign_in', ${session.id}, ${ip})`;
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: config.dashboardOrigin.startsWith("https://"),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_IDLE_DAYS * 24 * 3600,
    });
    return c.json(serializeMerchant(merchant), 200);
  },
);

dashboardAuth.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/auth/sign_out",
    operationId: "dashboard.auth.signOut",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "Signed out; cookie cleared.", content: { "application/json": { schema: z.object({ signed_out: z.literal(true) }) } } } },
  }),
  async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ signed_out: true as const }, 200);
  },
);
