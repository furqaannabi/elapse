/**
 * The keeper (contracts FR-CON-033/034, cadence decided 2026-09-05: 5 minutes; worker FR-WRK-070/071).
 *
 * Every tick it asks the chain to `settleBatch` two sets of active streams: those whose last
 * requested settle is older than the cadence, so a long session keeps growing its invoice list,
 * and those past their cap, whose first `settle()` is what emits the cap-end pair (`Settled` +
 * `StreamCanceled`, FR-CON-041). Paused streams accrue nothing and are skipped. The `Settled`
 * logs come back through the indexer and ingest like every other chain event; the keeper
 * writes nothing but `last_settle_requested_at`.
 *
 * Gas (FR-WRK-072, ADR 2026-09-07 keeper gas): the factory's try/catch makes the node's estimate
 * for the batch exactly the out-of-gas amount, so every stream is estimated directly first, a
 * reverting stream is skipped (and logged at most hourly), and the batch is gassed from the sum.
 */
import type { Address } from "viem";
import { config } from "../config";
import { sampleRelayerBalance } from "./relayer-balance";
import { sql } from "../db/client";
import { chainClient } from "../chain/relayer";
import { sleep } from "./sleep";
import { requestReconcile } from "./reconcile";
import { runUnstartedSweepOnce } from "./unstarted";

export const KEEPER_CADENCE_S = Number(process.env.KEEPER_CADENCE_S ?? 300);
export const KEEPER_TICK_MS = Number(process.env.KEEPER_TICK_MS ?? 30_000);
const DEFAULT_BATCH = 50;
const BATCH_BASE_GAS = 25_000n;
const SKIP_LOG_INTERVAL_S = 3600;

/** `25 000 + Σ direct estimates × 1.25`; zero for an empty batch, which is never sent. */
export function batchGas(estimates: bigint[]): bigint {
  if (estimates.length === 0) return 0n;
  const sum = estimates.reduce((a, b) => a + b, 0n);
  return BATCH_BASE_GAS + (sum * 125n) / 100n;
}

/** When each skipped stream was last logged, so a stuck stream is one line an hour, not one a tick. */
const skipLoggedAt = new Map<string, number>();

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

export async function runKeeperOnce(o: { now?: number; batch?: number; cadenceS?: number; log?: KeeperLogger | undefined } = {}): Promise<{ settled: string[]; skipped: string[]; failed: number }> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const batch = o.batch ?? DEFAULT_BATCH;
  const log = o.log ?? ((e) => console.log(JSON.stringify({ at: new Date().toISOString(), keeper: true, ...e })));
  const due = await selectDue(now, o.cadenceS);
  const settled: string[] = [];
  const skipped: string[] = [];
  let failed = 0;
  const byChain = new Map<number, DueRow[]>();
  for (const r of due) byChain.set(r.chain_id, [...(byChain.get(r.chain_id) ?? []), r]);

  for (const [chainId, rows] of byChain) {
    for (let i = 0; i < rows.length; i += batch) {
      // FR-WRK-072: estimate each stream on its own; a revert here is real, and it never reaches the batch.
      const ready: { row: DueRow; gas: bigint }[] = [];
      for (const row of rows.slice(i, i + batch)) {
        try {
          ready.push({ row, gas: await chainClient().estimateSettle(chainId, row.stream_address as Address) });
        } catch (e) {
          skipped.push(row.stream_address);
          requestReconcile(row.stream_address); // the chain may have ended it without the indexer noticing (FR-WRK-073)
          const last = skipLoggedAt.get(row.stream_address) ?? -Infinity;
          if (now - last >= SKIP_LOG_INTERVAL_S) {
            skipLoggedAt.set(row.stream_address, now);
            log({ chain_id: chainId, stream: row.stream_address, skipped: (e as Error).message });
          }
        }
      }
      if (ready.length === 0) continue;
      const streams = ready.map((r) => r.row.stream_address as Address);
      const gas = batchGas(ready.map((r) => r.gas));
      try {
        const tx = await chainClient().settleBatch(chainId, streams, gas);
        await sql`UPDATE subscriptions SET last_settle_requested_at = to_timestamp(${now}) WHERE id = ANY(${sql.array(ready.map((r) => r.row.id), "TEXT")})`;
        settled.push(...streams);
        log({ chain_id: chainId, streams: streams.length, gas: gas.toString(), tx });
        // The drain signature: a batch that "succeeded" and emitted nothing burned its whole limit for nothing.
        const logs = await chainClient().receiptLogCount(chainId, tx);
        if (logs === 0) log({ level: "error", keeper_batch_no_effect: true, chain_id: chainId, streams: streams.length, gas: gas.toString(), tx });
      } catch (e) {
        failed += ready.length;
        log({ chain_id: chainId, streams: streams.length, error: (e as Error).message });
      }
    }
  }
  // FR-WRK-074: the gas sample rides on the tick; its failure never touches the settle result.
  await sampleRelayerBalance(Number(process.env.CHAIN_ID ?? config.chains.test), now, log);
  return { settled, skipped, failed };
}

/** Tick every `KEEPER_TICK_MS`; a failing RPC never stops the loop. `onTick` feeds the heartbeat. */
export async function keeperForever(signal?: AbortSignal, log?: KeeperLogger, onTick?: () => void): Promise<void> {
  while (!signal?.aborted) {
    try {
      await runKeeperOnce({ log });
      // FR-WRK-075 rides the same tick; its failure must never stop settlement.
      try {
        await runUnstartedSweepOnce({ log });
      } catch (e) {
        console.error("unstarted sweep crashed", { message: (e as Error).message });
      }
      onTick?.();
    } catch (e) {
      console.error("keeper tick crashed", { message: (e as Error).message });
    }
    await sleep(KEEPER_TICK_MS, signal);
  }
}
