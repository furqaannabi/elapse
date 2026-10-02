/**
 * Checkout logo (FR-API-104, ADR 2026-09-07 forms hardening): upload a PNG ≤ 50 KB, serve it
 * publicly, delete it. The bytes live in `merchants.logo_png`; `branding.logo_url` is the
 * public URL with a content-hash query, so checkout sessions carry a small URL and a
 * replaced logo never shows a cached predecessor. The signature bytes decide what a PNG is,
 * never the file name or the declared type; SVG is refused outright.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { sql } from "../db/client";
import { checklist, getMerchantProfile, serializeProfile } from "../db/merchant-profile";
import { ApiError, invalid } from "../lib/errors";
import { router } from "../lib/openapi";
import { clientIp, sessionAuth, type AuthEnv } from "../middleware/auth";
import { ProfileSchema } from "./dashboard-me";

export const LOGO_MAX_BYTES = 50 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOGO_MESSAGE = "Use a PNG under 50 KB.";

/** True only for bytes that begin with the PNG signature and fit the cap. */
export function isAcceptablePng(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const dashboardLogo = router<AuthEnv>();
dashboardLogo.use("/dashboard/branding/logo", sessionAuth());

dashboardLogo.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/branding/logo",
    operationId: "dashboard.logo.upload",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "multipart/form-data": { schema: z.object({ logo: z.any().openapi({ type: "string", format: "binary" }) }) } } } },
    responses: { 200: { description: "The updated merchant, `branding.logo_url` pointing at the new logo.", content: { "application/json": { schema: ProfileSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw invalid("Send the logo as multipart form data.", "logo");
    }
    const file = form.get("logo");
    if (!(file instanceof File)) throw invalid("Attach a PNG under 50 KB as `logo`.", "logo");
    if (file.size > LOGO_MAX_BYTES) throw invalid(LOGO_MESSAGE, "logo");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isAcceptablePng(bytes)) throw invalid(LOGO_MESSAGE, "logo");
    const m = await getMerchantProfile(auth.merchantId);
    if (!m) throw new ApiError(404, "not_found", "No such merchant.");
    const url = `${config.publicApiUrl}/v1/dashboard/branding/logo/${auth.merchantId}?v=${await contentHash(bytes)}`;
    const branding = { ...m.branding, logo_url: url };
    const ip = clientIp(c);
    await sql.begin(async (tx) => {
      await tx`UPDATE merchants SET logo_png = ${bytes}, branding = ${branding} WHERE id = ${auth.merchantId}`;
      await tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${auth.merchantId}, 'dashboard', 'merchant.updated', 'logo', ${ip})`;
    });
    const after = (await getMerchantProfile(auth.merchantId))!;
    return c.json(serializeProfile(after, auth.livemode, await checklist(auth.merchantId, auth.livemode), auth.demo === true), 200);
  },
);

dashboardLogo.openapi(
  createRoute({
    method: "delete",
    path: "/dashboard/branding/logo",
    operationId: "dashboard.logo.delete",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "The updated merchant, `branding.logo_url` null.", content: { "application/json": { schema: ProfileSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const m = await getMerchantProfile(auth.merchantId);
    if (!m) throw new ApiError(404, "not_found", "No such merchant.");
    const branding = { ...m.branding, logo_url: null };
    const ip = clientIp(c);
    await sql.begin(async (tx) => {
      await tx`UPDATE merchants SET logo_png = NULL, branding = ${branding} WHERE id = ${auth.merchantId}`;
      await tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${auth.merchantId}, 'dashboard', 'merchant.updated', 'logo_removed', ${ip})`;
    });
    const after = (await getMerchantProfile(auth.merchantId))!;
    return c.json(serializeProfile(after, auth.livemode, await checklist(auth.merchantId, auth.livemode), auth.demo === true), 200);
  },
);

// Public: the checkout and the account page load it like any image. No cookie, no key.
dashboardLogo.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/branding/logo/{merchant_id}",
    operationId: "dashboard.logo.get",
    tags: ["Dashboard"],
    hide: true,
    request: { params: z.object({ merchant_id: z.string().max(64) }) },
    responses: { 200: { description: "The PNG.", content: { "image/png": { schema: z.string().openapi({ format: "binary" }) } } } },
  }),
  async (c) => {
    const { merchant_id } = c.req.valid("param");
    const [row] = await sql`SELECT logo_png FROM merchants WHERE id = ${merchant_id} AND logo_png IS NOT NULL`;
    if (!row) throw new ApiError(404, "not_found", "No logo.");
    return new Response(new Uint8Array(row.logo_png as Uint8Array) as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
  },
);
