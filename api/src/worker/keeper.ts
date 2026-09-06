/**
 * The keeper (contracts FR-CON-033/034, cadence decided 2026-09-05: 5 minutes; worker FR-WRK-070/071).
 *
 * Every tick it asks the chain to `settleBatch` two sets of active streams: those whose last
 * requested settle is older than the cadence, so a long session keeps growing its invoice list,
 * and those past their cap, whose first `settle()` is what emits the cap-end pair (`Settled` +
 * `StreamCanceled`, FR-CON-041). Paused streams accrue nothing and are skipped. The `Settled`
 * logs come back through the indexer and ingest like every other chain event; the keeper
 * writes nothing but `last_settle_requested_at`.
 */
import type { Address } from "viem";
import { sql } from "../db/client";
import { chainClient } from "../chain/relayer";

export const KEEPER_CADENCE_S = Number(process.env.KEEPER_CADENCE_S ?? 300);
export const KEEPER_TICK_MS = Number(process.env.KEEPER_TICK_MS ?? 30_000);
const DEFAULT_BATCH = 50;

export type KeeperLogger = (entry: Record<string, unknown>) => void;

interface DueRow {
  id: string;
  chain_id: number;
  stream_address: string;
}

/** Active streams due by cadence or past their cap, oldest request first. */
export async function selectDue(now: number, cadenceS = KEEPER_CADENCE_S): Promise<DueRow[]> {
  const rows = await sql`
    SELECT id, chain_id, stream_address
    FROM subscriptions
    WHERE status = 'active' AND stream_address IS NOT NULL AND started_at IS NOT NULL
      AND (
        COALESCE(last_settle_requested_at, started_at) <= to_timestamp(${now}) - make_interval(secs => ${cadenceS})
        OR started_at + make_interval(secs => max_duration_seconds + paused_seconds) <= to_timestamp(${now})
      )
    ORDER BY chain_id, COALESCE(last_settle_requested_at, started_at)`;
  return rows as DueRow[];
}

export async function runKeeperOnce(o: { now?: number; batch?: number; cadenceS?: number; log?: KeeperLogger | undefined } = {}): Promise<{ settled: string[]; failed: number }> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const batch = o.batch ?? DEFAULT_BATCH;
  const log = o.log ?? ((e) => console.log(JSON.stringify({ at: new Date().toISOString(), keeper: true, ...e })));
  const due = await selectDue(now, o.cadenceS);
  const settled: string[] = [];
  let failed = 0;
  const byChain = new Map<number, DueRow[]>();
  for (const r of due) byChain.set(r.chain_id, [...(byChain.get(r.chain_id) ?? []), r]);

  for (const [chainId, rows] of byChain) {
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      const streams = chunk.map((r) => r.stream_address as Address);
      try {
        const tx = await chainClient().settleBatch(chainId, streams);
        await sql`UPDATE subscriptions SET last_settle_requested_at = to_timestamp(${now}) WHERE id = ANY(${sql.array(chunk.map((r) => r.id), "TEXT")})`;
        settled.push(...chunk.map((r) => r.stream_address));
        log({ chain_id: chainId, streams: streams.length, tx });
      } catch (e) {
        failed += chunk.length;
        log({ chain_id: chainId, streams: streams.length, error: (e as Error).message });
      }
    }
  }
  return { settled, failed };
}

/** Tick every `KEEPER_TICK_MS`; a failing RPC never stops the loop. `onTick` feeds the heartbeat. */
export async function keeperForever(signal?: AbortSignal, log?: KeeperLogger, onTick?: () => void): Promise<void> {
  while (!signal?.aborted) {
    try {
      await runKeeperOnce({ log });
      onTick?.();
    } catch (e) {
      console.error("keeper tick crashed", { message: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, KEEPER_TICK_MS));
  }
}
