import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config";
import { magicLinkMail } from "../lib/mail-templates";
import { createApiKey } from "../db/api-keys";
import { consumeMagicLink, issueMagicLink, MagicLinkRateLimited } from "../db/magic-links";
import { createMerchant, findMerchantByEmail, type Merchant } from "../db/merchants";
import { DEMO_EMAIL, demoPin, demoPinGate, findDemoMerchant, pinMatches, recordPinAttempt } from "../db/demo";
import { createSession, DEMO_SESSION_HOURS, deleteSession, SESSION_IDLE_DAYS } from "../db/sessions";
import { sql } from "../db/client";
import { ApiError, notFound, unauthorized } from "../lib/errors";
import { mailIsDevOnly, sendEmail } from "../lib/email";
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

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string, maxAge: number) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: config.dashboardOrigin.startsWith("https://"), sameSite: "Lax", path: "/", maxAge });
}

dashboardAuth.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/auth/magic_link",
    operationId: "dashboard.auth.magicLink",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ email: z.email().max(254) }) } }, required: true } },
    responses: { 200: { description: "Always sent:true (no account enumeration). `dev_token` appears only when mail is stdout-only in development.", content: { "application/json": { schema: z.object({ sent: z.literal(true), dev_token: z.string().optional() }) } } } },
  }),
  async (c) => {
    const email = c.req.valid("json").email.toLowerCase();
    // BR-API-010: the demo merchant is reached by its PIN only. Same answer as any address, so the
    // route still says nothing about which accounts exist; no link is issued and no mail is sent.
    if (email === DEMO_EMAIL) return c.json({ sent: true as const }, 200);
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
    // The logo is the web app's PNG mark (email clients refuse SVG); same origin as the link.
    await sendEmail({ to: email, ...magicLinkMail({ link, logoUrl: `${new URL(config.checkoutBaseUrl).origin}/apple-icon.png` }) });
    // Local development has no inbox: hand the token to the login page so sign-in completes in the browser.
    return c.json({ sent: true as const, ...(mailIsDevOnly() ? { dev_token: token } : {}) }, 200);
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
    setSessionCookie(c, session.token, SESSION_IDLE_DAYS * 24 * 3600);
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

// ─── Demo sign-in (FR-API-152, ADR 2026-10-02 demo account) ─────────────────────

dashboardAuth.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/auth/demo",
    operationId: "dashboard.auth.demoAvailable",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "Whether the login page should offer the demo account.", content: { "application/json": { schema: z.object({ available: z.boolean() }) } } } },
  }),
  async (c) => c.json({ available: demoPin() !== null && (await findDemoMerchant()) !== null }, 200),
);

dashboardAuth.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/auth/demo",
    operationId: "dashboard.auth.demo",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ pin: z.string().regex(/^\d{6}$/, "must be six digits") }) } }, required: true } },
    responses: { 200: { description: "Signed in to the demo account; the session cookie is set.", content: { "application/json": { schema: MerchantSchema } } } },
  }),
  async (c) => {
    const pin = demoPin();
    const merchant = pin ? await findDemoMerchant() : null;
    if (!pin || !merchant) throw notFound("demo");
    const ip = clientIp(c);
    const gate = await demoPinGate(ip);
    if (!gate.ok) {
      c.header("Retry-After", String(gate.retryAfter));
      const message =
        gate.code === "demo_pin_paused" ? "The demo is resting after too many wrong PINs. Try again later." : gate.code === "demo_pin_ip_limited" ? "Too many tries. Try again later." : "Too many demo sign-ins from here. Try again later.";
      throw new ApiError(429, "rate_limit_error", message, undefined, gate.code === "rate_limited" ? undefined : gate.code);
    }
    const ok = pinMatches(c.req.valid("json").pin, pin);
    await recordPinAttempt(ip, ok);
    if (!ok) {
      // The IP only, never the guess.
      console.warn("demo_pin_invalid", { ip });
      throw new ApiError(401, "authentication_error", "That PIN isn't right.", undefined, "demo_pin_invalid");
    }
    const session = await createSession(merchant.id, ip, { demo: true });
    await sql`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${merchant.id}, 'dashboard', 'sign_in_demo', ${session.id}, ${ip})`;
    setSessionCookie(c, session.token, DEMO_SESSION_HOURS * 3600);
    return c.json(serializeMerchant(merchant), 200);
  },
);
