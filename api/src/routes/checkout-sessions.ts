import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { findCheckoutSession, insertCheckoutSession, type CheckoutSessionRow } from "../db/checkout-sessions";
import { getMerchantBranding, type MerchantBranding } from "../db/merchants";
import { findProduct, type ProductRow } from "../db/products";
import { invalid, notFound } from "../lib/errors";
import { baseUnitsToDecimal } from "../lib/money";
import { router } from "../lib/openapi";
import { requireKey, type AuthEnv } from "../middleware/auth";
import { ProductSchema, serializeProduct } from "./products";

/**
 * Checkout sessions (FR-API-030, FR-API-031, FR-API-033). Create with `sk_`;
 * read with `sk_` (full) or `pk_` (public projection, BR-CHK-005).
 * `prepare` and `start` (FR-API-032) arrive with the customers/subscriptions slice.
 */

const SESSION_TTL_SECONDS = 24 * 3600;
const MIN_CAP = 60;
const MAX_CAP = 2_592_000; // 30 days

const BrandingSchema = z.object({
  name: z.string(),
  logo_url: z.string().nullable(),
  accent: z.string().nullable(),
  support_url: z.string().nullable(),
});

const PublicProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  rate_usd_per_second: z.string(),
  allow_pause: z.boolean(),
  active: z.boolean(),
});

export const CheckoutSessionSchema = z
  .object({
    id: z.string().openapi({ example: "cs_3fT8kLm2Qp9RxV" }),
    object: z.literal("checkout.session"),
    status: z.enum(["open", "complete", "expired"]),
    url: z.string().openapi({ description: "Send the subscriber here." }),
    livemode: z.boolean(),
    created: z.number().int(),
    expires_at: z.number().int().openapi({ description: "Unix seconds; 24 h after creation." }),
    success_url: z.string(),
    cancel_url: z.string(),
    product: ProductSchema,
    merchant: BrandingSchema,
    customer: z.null(),
    subscription: z.null(),
    max_duration_seconds: z.number().int().nullable(),
    max_escrow_usd: z.string().nullable().openapi({ description: "rate × max_duration_seconds, exact decimal." }),
  })
  .openapi("CheckoutSession");

/** What the hosted page reads with a publishable key: exactly the checkout FRD `CheckoutSession` type, snake_case. */
export const PublicCheckoutSessionSchema = z
  .object({
    id: z.string(),
    object: z.literal("checkout.session"),
    status: z.enum(["open", "complete", "expired"]),
    expires_at: z.number().int(),
    merchant: BrandingSchema.extend({ success_url: z.string(), cancel_url: z.string() }),
    product: PublicProductSchema,
    customer: z.null(),
    subscription: z.null(),
    max_duration_seconds: z.number().int().nullable(),
    max_escrow_usd: z.string().nullable(),
  })
  .openapi("PublicCheckoutSession");

const urlField = (livemode: boolean, param: string) =>
  z.string().superRefine((s, ctx) => {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be an absolute URL" });
      return;
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && !livemode)) {
      ctx.addIssue({ code: "custom", message: livemode ? "must use https in live mode" : "must be http or https" });
    }
  });

const CreateBody = z
  .strictObject({
    product: z.string().openapi({ example: "prod_9Xk2mQ1pL0vRsT" }),
    success_url: z.string().openapi({ example: "https://acme.test/welcome" }),
    cancel_url: z.string().openapi({ example: "https://acme.test/pricing" }),
    max_duration_seconds: z
      .number()
      .int()
      .min(MIN_CAP)
      .max(MAX_CAP)
      .optional()
      .openapi({ description: "Fix the subscriber's cap. Omit to let them choose on the page (60 s – 30 days)." }),
  })
  .openapi("CreateCheckoutSession");

/** `rate_per_second_wei × seconds` → USD decimal string, BigInt only (BR-API-004). */
export function maxEscrowUsd(product: ProductRow, seconds: number | null): string | null {
  if (seconds === null) return null;
  return baseUnitsToDecimal(BigInt(product.rate_per_second_wei) * BigInt(seconds), config.tokenDecimals);
}

function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export function serializeSession(s: CheckoutSessionRow, product: ProductRow, merchant: MerchantBranding) {
  return {
    id: s.id,
    object: "checkout.session" as const,
    status: s.status,
    url: `${config.checkoutBaseUrl}/c/${s.id}`,
    livemode: s.livemode,
    created: unix(s.created_at),
    expires_at: unix(s.expires_at),
    success_url: s.success_url,
    cancel_url: s.cancel_url,
    product: serializeProduct(product),
    merchant,
    customer: null,
    subscription: null,
    max_duration_seconds: s.max_duration_seconds,
    max_escrow_usd: maxEscrowUsd(product, s.max_duration_seconds),
  };
}

export function serializePublicSession(s: CheckoutSessionRow, product: ProductRow, merchant: MerchantBranding) {
  return {
    id: s.id,
    object: "checkout.session" as const,
    status: s.status,
    expires_at: unix(s.expires_at),
    merchant: { ...merchant, success_url: s.success_url, cancel_url: s.cancel_url },
    product: {
      id: product.id,
      name: product.name,
      rate_usd_per_second: serializeProduct(product).rate_usd_per_second,
      allow_pause: product.allow_pause,
      active: product.active,
    },
    customer: null,
    subscription: null,
    max_duration_seconds: s.max_duration_seconds,
    max_escrow_usd: maxEscrowUsd(product, s.max_duration_seconds),
  };
}

export const checkoutSessions = router<AuthEnv>();

checkoutSessions.openapi(
  createRoute({
    method: "post",
    path: "/checkout/sessions",
    operationId: "checkout.sessions.create",
    tags: ["Checkout"],
    middleware: [requireKey(["sk"])] as const,
    request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
    responses: {
      200: { description: "The session; send the subscriber to `url`.", content: { "application/json": { schema: CheckoutSessionSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    for (const param of ["success_url", "cancel_url"] as const) {
      const r = urlField(auth.livemode, param).safeParse(body[param]);
      if (!r.success) throw invalid(`Invalid ${param}: ${r.error.issues[0]!.message}`, param);
    }
    const product = await findProduct(auth.merchantId, auth.livemode, body.product);
    if (!product) throw invalid(`No such product: '${body.product}'`, "product");
    if (!product.active) throw invalid(`Product '${body.product}' is archived.`, "product");
    const merchant = (await getMerchantBranding(auth.merchantId))!;
    const row = await insertCheckoutSession({
      merchantId: auth.merchantId,
      livemode: auth.livemode,
      productId: product.id,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
      maxDurationSeconds: body.max_duration_seconds ?? null,
      ttlSeconds: SESSION_TTL_SECONDS,
    });
    return c.json(serializeSession(row, product, merchant), 200);
  },
);

checkoutSessions.openapi(
  createRoute({
    method: "get",
    path: "/checkout/sessions/{id}",
    operationId: "checkout.sessions.retrieve",
    tags: ["Checkout"],
    middleware: [requireKey(["sk", "pk"])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Full object with a secret key; public projection with a publishable key.",
        content: { "application/json": { schema: z.union([CheckoutSessionSchema, PublicCheckoutSessionSchema]) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findCheckoutSession(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("checkout session", id);
    const product = (await findProduct(auth.merchantId, auth.livemode, row.product_id))!;
    const merchant = (await getMerchantBranding(auth.merchantId))!;
    const body = auth.keyKind === "pk" ? serializePublicSession(row, product, merchant) : serializeSession(row, product, merchant);
    return c.json(body, 200);
  },
);
