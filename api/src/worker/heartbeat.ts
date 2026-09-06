/**
 * Worker heartbeat (worker FRD FR-WRK-060). The worker writes one row every 5 s with its live
 * counters; `GET /v1/status` reads the newest and calls the worker stalled when the row is
 * older than 15 s. Without it a dead worker looks like an empty queue.
 */
import { sql } from "../db/client";
import { sleep } from "./sleep";

export const HEARTBEAT_EVERY_MS = 5_000;
export const HEARTBEAT_STALE_S = 15;

export interface WorkerHealth {
  alive: boolean;
  worker_id: string | null;
  /** Unix seconds. */
  last_seen_at: number | null;
  started_at: number | null;
  attempts_last_minute: number;
  success_rate_1h: number | null;
  keeper_last_tick_at: number | null;
}

/** Upsert this worker's row with counters computed from delivery_attempts. */
export async function beat(workerId: string, o: { now?: Date; keeperTickAt?: Date | null } = {}): Promise<void> {
  const now = o.now ?? new Date();
  const [c] = await sql`
    SELECT count(*) FILTER (WHERE sent_at > ${now}::timestamptz - interval '1 minute')::int AS last_minute,
           count(*) FILTER (WHERE sent_at > ${now}::timestamptz - interval '1 hour')::int AS hour_total,
           count(*) FILTER (WHERE sent_at > ${now}::timestamptz - interval '1 hour' AND status_code BETWEEN 200 AND 299)::int AS hour_ok
    FROM delivery_attempts`;
  const rate = c!.hour_total > 0 ? c!.hour_ok / c!.hour_total : null;
  await sql`
    INSERT INTO worker_heartbeat (worker_id, seen_at, started_at, attempts_last_minute, success_rate_1h, keeper_last_tick_at)
    VALUES (${workerId}, ${now}::timestamptz, ${now}::timestamptz, ${c!.last_minute}, ${rate}, ${o.keeperTickAt ?? null})
    ON CONFLICT (worker_id) DO UPDATE SET
      seen_at = EXCLUDED.seen_at,
      attempts_last_minute = EXCLUDED.attempts_last_minute,
      success_rate_1h = EXCLUDED.success_rate_1h,
      keeper_last_tick_at = COALESCE(EXCLUDED.keeper_last_tick_at, worker_heartbeat.keeper_last_tick_at)`;
}

const epoch = (d: Date | null | undefined): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

/** The newest heartbeat, judged against `now`. */
export async function workerHealth(now = new Date()): Promise<WorkerHealth> {
  const [row] = await sql`SELECT worker_id, seen_at, started_at, attempts_last_minute, success_rate_1h::float AS success_rate_1h, keeper_last_tick_at
                          FROM worker_heartbeat ORDER BY seen_at DESC LIMIT 1`;
  if (!row) return { alive: false, worker_id: null, last_seen_at: null, started_at: null, attempts_last_minute: 0, success_rate_1h: null, keeper_last_tick_at: null };
  const ageS = (now.getTime() - (row.seen_at as Date).getTime()) / 1000;
  return {
    alive: ageS <= HEARTBEAT_STALE_S,
    worker_id: row.worker_id,
    last_seen_at: epoch(row.seen_at),
    started_at: epoch(row.started_at),
    attempts_last_minute: row.attempts_last_minute,
    success_rate_1h: row.success_rate_1h === null ? null : Number(row.success_rate_1h),
    keeper_last_tick_at: epoch(row.keeper_last_tick_at),
  };
}

/** Beat every 5 s until aborted. A failed write is logged and retried on the next beat. */
export async function heartbeatForever(workerId: string, keeperTick: () => Date | null, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      await beat(workerId, { keeperTickAt: keeperTick() });
    } catch (e) {
      console.error("heartbeat failed", { message: (e as Error).message });
    }
    await sleep(HEARTBEAT_EVERY_MS, signal);
  }
}
