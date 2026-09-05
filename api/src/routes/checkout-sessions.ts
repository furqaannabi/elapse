import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { findCheckoutSession, insertCheckoutSession, type CheckoutSessionRow } from "../db/checkout-sessions";
import { getMerchantBranding, type MerchantBranding } from "../db/merchants";
import { findProduct, type ProductRow } from "../db/products";
import { ApiError, invalid, notFound } from "../lib/errors";
import { findSubscription, serializeSubscription, type SubscriptionRow } from "../db/subscriptions";
import { findCustomer } from "../db/customers";
import { RelayerUnavailable } from "../chain/relayer";
import { CheckoutStateError, prepareSession, startSession, PERMIT_TTL_SECONDS } from "../services/checkout";
import { PERMIT_TYPES } from "../chain/permit";
import { baseUnitsToDecimal } from "../lib/money";
import { router } from "../lib/openapi";
import { merchantAuth, requireAuth, type AuthEnv } from "../middleware/auth";
import { ProductSchema, serializeProduct } from "./products";

/**
 * Checkout sessions (FR-API-030, FR-API-031, FR-API-033). Create with `sk_`;
 * read with `sk_` (full) or `pk_` (public projection, BR-CHK-005).
 * `prepare` and `start` (FR-API-032) are the subscriber's two actions with a `pk_`: bind a
 * wallet and a cap, then hand over the permit signature for the relayer to submit. The wallet
 * is trusted from the page for now and proven by the signature at `start`; a Privy identity
 * token becomes required in Week 4 (William, 2026-09-05, option c).
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

/** FR-API-040 wire object; shared with the subscriptions routes when they land. */
export const SubscriptionSchema = z
  .object({
    id: z.string().openapi({ example: "sub_7Hq2mV9kLp3RxT" }),
    object: z.literal("subscription"),
    status: z.enum(["incomplete", "active", "paused", "canceled"]),
    product: z.string(),
    customer: z.string(),
    checkout_session: z.string().nullable(),
    rate_usd_per_second: z.string(),
    started_at: z.number().int().nullable(),
    paused_at: z.number().int().nullable(),
    canceled_at: z.number().int().nullable(),
    ended_reason: z.enum(["canceled", "cap_reached"]).nullable(),
    max_duration_seconds: z.number().int(),
    max_escrow_usd: z.string(),
    funded_usd: z.string(),
    settled_usd: z.string(),
    seconds_elapsed: z.number().int(),
    stream_address: z.string().nullable(),
    chain_id: z.number().int(),
    currency: z.literal("ausd"),
    livemode: z.boolean(),
    created: z.number().int(),
  })
  .openapi("Subscription");

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
    customer: z.string().nullable().openapi({ description: "cus_ id once the subscriber has signed in." }),
    subscription: z.string().nullable().openapi({ description: "sub_ id once prepared; retrieve it for status." }),
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
    customer: z.object({ id: z.string(), email: z.string().nullable() }).nullable(),
    subscription: SubscriptionSchema.nullable(),
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
    customer: s.customer_id,
    subscription: s.subscription_id,
    max_duration_seconds: s.max_duration_seconds,
    max_escrow_usd: maxEscrowUsd(product, s.max_duration_seconds),
  };
}

/** The projection the hosted page reads: the checkout FRD `CheckoutSession` type, with the subscription inline. */
export function serializePublicSession(
  s: CheckoutSessionRow,
  product: ProductRow,
  merchant: MerchantBranding,
  sub: SubscriptionRow | null = null,
  customer: { id: string; email: string | null } | null = null,
) {
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
    customer,
    subscription: sub ? serializeSubscription(sub) : null,
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
    middleware: [merchantAuth()] as const,
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
    middleware: [requireAuth({ keys: ["sk", "pk"], session: true })] as const,
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
    if (auth.via === "key" && auth.keyKind === "pk") {
      const sub = row.subscription_id ? await findSubscription(auth.merchantId, auth.livemode, row.subscription_id) : null;
      const cus = row.customer_id ? await findCustomer(auth.merchantId, auth.livemode, row.customer_id) : null;
      return c.json(serializePublicSession(row, product, merchant, sub, cus ? { id: cus.id, email: cus.email } : null), 200);
    }
    return c.json(serializeSession(row, product, merchant), 200);
  },
);

// ─── Subscriber actions (FR-API-032) ─────────────────────────────────────────

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

const PrepareBody = z
  .strictObject({
    max_duration_seconds: z.number().int().min(MIN_CAP).max(MAX_CAP),
    wallet_address: z.string().regex(ADDRESS, "must be a 0x-prefixed 20-byte address"),
    email: z.string().email().max(254).optional(),
  })
  .openapi("PrepareCheckoutSession");

const PermitSchema = z.object({
  domain: z.object({ name: z.string(), version: z.string(), chainId: z.number().int(), verifyingContract: z.string() }),
  types: z.object({ Permit: z.array(z.object({ name: z.string(), type: z.string() })) }),
  primaryType: z.literal("Permit"),
  message: z.object({ owner: z.string(), spender: z.string(), value: z.string(), nonce: z.string(), deadline: z.string() }),
});

const PrepareResponse = z
  .object({
    customer: z.string(),
    subscription: z.string(),
    chain_id: z.number().int(),
    max_duration_seconds: z.number().int(),
    max_escrow_usd: z.string(),
    permit: PermitSchema.openapi({ description: `EIP-712 typed data the subscriber's wallet signs; valid ${PERMIT_TTL_SECONDS} s.` }),
  })
  .openapi("PreparedCheckoutSession");

const StartBody = z.strictObject({ signature: z.string().regex(SIGNATURE, "must be a 65-byte hex signature") }).openapi("StartCheckoutSession");
const StartResponse = z.object({ subscription: z.string(), pending_tx: z.string() }).openapi("StartedCheckoutSession");

/** Service errors → FR-API-082 shape. Conflicts are 409; a missing relayer is our fault (503). */
function mapCheckoutError(e: unknown): never {
  if (e instanceof CheckoutStateError) {
    const status = e.code === "already_started" || e.code === "session_not_open" ? 409 : 400;
    throw new ApiError(status, "invalid_request_error", e.message, undefined, e.code);
  }
  if (e instanceof RelayerUnavailable) throw new ApiError(503, "api_error", "Starting sessions is temporarily unavailable.");
  throw e;
}

checkoutSessions.openapi(
  createRoute({
    method: "post",
    path: "/checkout/sessions/{id}/prepare",
    operationId: "checkout.sessions.prepare",
    tags: ["Checkout"],
    hide: true,
    middleware: [requireAuth({ keys: ["pk"], session: false })] as const,
    request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: PrepareBody } }, required: true } },
    responses: { 200: { description: "Customer, incomplete Subscription and the permit to sign.", content: { "application/json": { schema: PrepareResponse } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const session = await findCheckoutSession(auth.merchantId, auth.livemode, id);
    if (!session) throw notFound("checkout session", id);
    try {
      const out = await prepareSession({ session, walletAddress: body.wallet_address, email: body.email ?? null, maxDurationSeconds: body.max_duration_seconds });
      return c.json({ ...out, permit: { ...out.permit, types: PERMIT_TYPES as unknown as { Permit: { name: string; type: string }[] } } }, 200);
    } catch (e) {
      mapCheckoutError(e);
    }
  },
);

checkoutSessions.openapi(
  createRoute({
    method: "post",
    path: "/checkout/sessions/{id}/start",
    operationId: "checkout.sessions.start",
    tags: ["Checkout"],
    hide: true,
    middleware: [requireAuth({ keys: ["pk"], session: false })] as const,
    request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: StartBody } }, required: true } },
    responses: { 202: { description: "Submitted; `active` arrives when the chain confirms.", content: { "application/json": { schema: StartResponse } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { signature } = c.req.valid("json");
    const auth = c.get("auth");
    const session = await findCheckoutSession(auth.merchantId, auth.livemode, id);
    if (!session) throw notFound("checkout session", id);
    try {
      return c.json(await startSession({ session, signature }), 202);
    } catch (e) {
      mapCheckoutError(e);
    }
  },
);
