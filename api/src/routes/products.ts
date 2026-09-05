import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { findProduct, insertProduct, type ProductRow } from "../db/products";
import { invalid, notFound } from "../lib/errors";
import { decimalToBaseUnits } from "../lib/money";
import { router } from "../lib/openapi";
import { requireKey, type AuthEnv } from "../middleware/auth";

/**
 * Products (FR-API-010, FR-API-011). Merchant secret key only.
 * Wire format is snake_case (FR-API-083); the SDK maps camelCase in.
 */

const RateSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a decimal string such as \"0.004\"")
  .openapi({ example: "0.004", description: "USD per second as a decimal string. Never a float." });

export const ProductSchema = z
  .object({
    id: z.string().openapi({ example: "prod_9Xk2mQ1pL0vRsT" }),
    object: z.literal("product"),
    name: z.string(),
    description: z.string().nullable(),
    rate_usd_per_second: RateSchema,
    rate_per_second_wei: z.string().openapi({ example: "4000", description: "Rate in token base units (6 decimals for AUSD)." }),
    currency: z.literal("ausd"),
    allow_pause: z.boolean(),
    active: z.boolean(),
    livemode: z.boolean(),
    created: z.number().int().openapi({ description: "Unix seconds." }),
  })
  .openapi("Product");

const CreateProductBody = z
  .strictObject({
    name: z.string().min(1).max(200),
    rate_usd_per_second: RateSchema,
    description: z.string().max(1000).optional(),
    allow_pause: z.boolean().optional(),
  })
  .openapi("CreateProduct");

export function serializeProduct(p: ProductRow) {
  return {
    id: p.id,
    object: "product" as const,
    name: p.name,
    description: p.description,
    rate_usd_per_second: trimDecimal(p.rate_usd_per_second),
    rate_per_second_wei: p.rate_per_second_wei,
    currency: "ausd" as const,
    allow_pause: p.allow_pause,
    active: p.active,
    livemode: p.livemode,
    created: Math.floor(p.created_at.getTime() / 1000),
  };
}

/** Postgres returns NUMERIC(38,18) as "0.004000000000000000"; the merchant sent "0.004" and gets "0.004" back. */
function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export const products = router<AuthEnv>();
products.use("*", requireKey(["sk"]));

products.openapi(
  createRoute({
    method: "post",
    path: "/products",
    operationId: "products.create",
    tags: ["Products"],
    request: { body: { content: { "application/json": { schema: CreateProductBody } }, required: true } },
    responses: {
      200: { description: "The created product.", content: { "application/json": { schema: ProductSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const wei = decimalToBaseUnits(body.rate_usd_per_second, config.tokenDecimals);
    if (wei === null) {
      throw invalid(
        `rate_usd_per_second must be representable with at most ${config.tokenDecimals} decimal places.`,
        "rate_usd_per_second",
      );
    }
    if (wei === 0n) throw invalid("rate_usd_per_second must be greater than zero.", "rate_usd_per_second");
    const row = await insertProduct({
      merchantId: auth.merchantId,
      livemode: auth.livemode,
      name: body.name,
      description: body.description ?? null,
      rateUsdPerSecond: body.rate_usd_per_second,
      ratePerSecondWei: wei,
      allowPause: body.allow_pause ?? false,
    });
    return c.json(serializeProduct(row), 200);
  },
);

products.openapi(
  createRoute({
    method: "get",
    path: "/products/{id}",
    operationId: "products.retrieve",
    tags: ["Products"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "The product.", content: { "application/json": { schema: ProductSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await findProduct(auth.merchantId, auth.livemode, id);
    if (!row) throw notFound("product", id);
    return c.json(serializeProduct(row), 200);
  },
);
