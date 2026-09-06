import { createRoute, z } from "@hono/zod-openapi";
import { config } from "../config";
import { sql } from "../db/client";
import { deploymentFor } from "../chain/deployments";
import { indexerReader } from "../lib/indexer";
import { router } from "../lib/openapi";
import { workerHealth } from "../worker/heartbeat";

/**
 * `GET /v1/status` (FR-API-074): public, for judge mode (checkout FR-CHK-011). Chain, contracts,
 * indexer lag and the webhook queue in one call. Nothing here is secret; nothing here is
 * merchant-scoped. Monad blocks land every ~400 ms, which the panel uses for its block ticker.
 */
const MONAD_BLOCK_TIME_MS = 400;

export const StatusSchema = z
  .object({
    chain_id: z.number().int(),
    block_time_ms: z.number().int(),
    contracts: z.object({ factory: z.string(), token: z.string() }),
    indexer: z.object({
      ok: z.boolean(),
      latest_block: z.number().int().nullable(),
      head_block: z.number().int().nullable(),
      lag_blocks: z.number().int().nullable(),
      lag_seconds: z.number().nullable(),
      unsent_events: z.number().int().nullable(),
      last_ingest_at: z.number().int().nullable(),
      error: z.string().optional(),
    }),
    worker: z.object({
      alive: z.boolean().openapi({ description: "A heartbeat within the last 15 s (FR-WRK-060)." }),
      last_seen_at: z.number().int().nullable(),
      queued: z.number().int(),
      oldest_queued_age_s: z.number().int(),
      attempts_last_minute: z.number().int(),
      success_rate_1h: z.number().nullable(),
      keeper_last_tick_at: z.number().int().nullable(),
    }),
  })
  .openapi("Status");

export const status = router();

status.openapi(
  createRoute({
    method: "get",
    path: "/status",
    operationId: "status.retrieve",
    tags: ["Status"],
    responses: { 200: { description: "Platform status for judge mode.", content: { "application/json": { schema: StatusSchema } } } },
  }),
  async (c) => {
    const chainId = Number(process.env.CHAIN_ID ?? config.chains.test);
    const d = deploymentFor(chainId);
    const [ingest] = await sql`SELECT extract(epoch FROM max(received_at))::bigint AS last FROM chain_events WHERE chain_id = ${chainId}`;
    const [queue] = await sql`SELECT count(*)::int AS queued, COALESCE(extract(epoch FROM now() - min(created_at)), 0)::int AS oldest
                              FROM deliveries WHERE status IN ('queued', 'retrying')`;
    const health = await workerHealth();
    let indexer: z.infer<typeof StatusSchema>["indexer"];
    try {
      const s = await indexerReader()(chainId);
      const lagBlocks = Math.max(0, s.head_block - s.latest_block);
      indexer = {
        ok: true,
        latest_block: s.latest_block,
        head_block: s.head_block,
        lag_blocks: lagBlocks,
        lag_seconds: Math.round((lagBlocks * MONAD_BLOCK_TIME_MS) / 100) / 10,
        unsent_events: s.unsent_events,
        last_ingest_at: ingest?.last ? Number(ingest.last) : null,
      };
    } catch {
      indexer = { ok: false, latest_block: null, head_block: null, lag_blocks: null, lag_seconds: null, unsent_events: null, last_ingest_at: ingest?.last ? Number(ingest.last) : null, error: "unreachable" };
    }
    return c.json(
      {
        chain_id: chainId,
        block_time_ms: MONAD_BLOCK_TIME_MS,
        contracts: { factory: d.factory.toLowerCase(), token: (chainId === 143 ? d.ausd : d.mockUsd).toLowerCase() },
        indexer,
        worker: {
          alive: health.alive,
          last_seen_at: health.last_seen_at,
          queued: queue!.queued,
          oldest_queued_age_s: queue!.oldest,
          attempts_last_minute: health.attempts_last_minute,
          success_rate_1h: health.success_rate_1h,
          keeper_last_tick_at: health.keeper_last_tick_at,
        },
      },
      200,
    );
  },
);
