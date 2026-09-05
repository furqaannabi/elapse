import { z } from "@hono/zod-openapi";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { ingestChainEvent, ModeMismatch } from "../db/ingest";
import { ApiError, unauthorized } from "../lib/errors";
import { router } from "../lib/openapi";

/**
 * `POST /internal/ingest` (FR-API-070..072): the indexer's only door into the platform.
 * Authenticated by the shared `INGEST_TOKEN`; a Merchant key or cookie is refused with the
 * same 401. Hidden from OpenAPI: it is not part of the Merchant API.
 */
const HEX = /^0x[0-9a-f]+$/i;
export const IngestBodySchema = z.object({
  chain_id: z.number().int().positive(),
  block_number: z.number().int().nonnegative(),
  block_hash: z.string().regex(HEX),
  block_timestamp: z.number().int().nonnegative(),
  tx_hash: z.string().regex(HEX),
  log_index: z.number().int().nonnegative(),
  address: z.string().regex(/^0x[0-9a-f]{40}$/i),
  event_name: z.string().min(1).max(64),
  args: z.record(z.string(), z.string()),
  ledger: z
    .array(z.object({ kind: z.enum(["deposit", "settlement", "fee", "refund"]), amount: z.string().regex(/^\d+$/), from: z.string().regex(HEX), to: z.string().regex(HEX) }))
    .default([]),
});

function bearerMatches(header: string | undefined): boolean {
  const token = config.ingestToken;
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const internal = router();

internal.use("/internal/*", async (c, next) => {
  if (!bearerMatches(c.req.header("authorization"))) throw unauthorized("Internal route.");
  await next();
});

internal.post("/internal/ingest", async (c) => {
  const parsed = IngestBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const param = issue?.path.map(String).join(".") || undefined;
    throw new ApiError(400, "invalid_request_error", param ? `Invalid ${param}: ${issue?.message}` : "Invalid request.", param);
  }
  try {
    const result = await ingestChainEvent(parsed.data);
    return c.json(result, 200);
  } catch (e) {
    if (e instanceof ModeMismatch) throw new ApiError(409, "invalid_request_error", e.message, undefined, "mode_mismatch");
    throw e;
  }
});

// Anything else under /internal/ is unknown, but still only after the token check.
internal.all("/internal/*", () => {
  throw new ApiError(404, "not_found", "Unrecognized internal route.");
});
