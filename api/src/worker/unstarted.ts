/**
 * FR-WRK-075 / FR-API-127: the unstarted-session sweep.
 *
 * A `merchant` start-mode session is funded at authorisation but does not accrue until the merchant
 * says the resource is ready (contracts FR-CON-019/055). That window is the subscriber's money sitting
 * in escrow earning them nothing, so it is bounded: past `min(max_duration_seconds, 15 min)` the keeper
 * cancels the stream and the subscriber is refunded in full (contracts FR-CON-056 — an unstarted
 * stream has accrued nothing, so the refund is the whole deposit).
 *
 * Modelled on `keeper.ts`: select due rows, submit, and let ingest carry the result back. Nothing here
 * writes the subscription's status — `StreamCanceled` does, like every other chain event.
 */
import type { Address } from "viem";
import { sql } from "../db/client";
import { chainClient } from "../chain/relayer";
import type { KeeperLogger } from "./keeper";

/** FR-API-127: the longest a merchant may hold a funded session without starting it. */
export const UNSTARTED_WINDOW_S = Number(process.env.UNSTARTED_WINDOW_S ?? 900);
const DEFAULT_BATCH = 50;

interface UnstartedRow {
  id: string;
  chain_id: number;
  stream_address: string;
}

/**
 * Funded, `merchant`-mode sessions that were never started and are past their window. The predicate
 * leads with `status`/`start_mode` so it rides the `subscriptions_unstarted_idx` partial index (0019).
 *
 * Two exclusions the signed text does not name but correctness needs: a row whose start the merchant
 * has already submitted is still `incomplete` until `StreamStarted` ingests (FR-API-049) and must not
 * be refunded out from under them; and a row already cancelled by an earlier tick is skipped, since it
 * too stays `incomplete` until `StreamCanceled` lands.
 */
export async function selectUnstarted(now: number, windowS = UNSTARTED_WINDOW_S, limit = DEFAULT_BATCH): Promise<UnstartedRow[]> {
  const rows = await sql`
    SELECT id, chain_id, stream_address
    FROM subscriptions
    WHERE status = 'incomplete' AND start_mode = 'merchant'
      AND stream_address IS NOT NULL AND funded_wei > 0
      AND start_submitted_at IS NULL
      AND cancel_submitted_at IS NULL
      AND created_at + make_interval(secs => LEAST(max_duration_seconds, ${windowS}::int)) <= to_timestamp(${now})
    ORDER BY created_at
    LIMIT ${limit}`;
  return rows as UnstartedRow[];
}

/**
 * One sweep tick. A failing cancel is logged and left with a null marker so the next tick retries it;
 * it never aborts the rest of the batch.
 */
export async function runUnstartedSweepOnce(
  o: { now?: number; batch?: number; windowS?: number; log?: KeeperLogger | undefined } = {},
): Promise<{ canceled: string[]; failed: number }> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const log = o.log ?? ((e) => console.log(JSON.stringify({ at: new Date().toISOString(), unstarted_sweep: true, ...e })));
  const due = await selectUnstarted(now, o.windowS, o.batch ?? DEFAULT_BATCH);
  const canceled: string[] = [];
  let failed = 0;

  for (const row of due) {
    try {
      const tx = await chainClient().cancel(row.chain_id, row.stream_address as Address);
      // Stamped only after the relayer accepted it, so a failure is retried rather than stranded.
      await sql`UPDATE subscriptions SET cancel_submitted_at = to_timestamp(${now}), updated_at = now() WHERE id = ${row.id}`;
      canceled.push(row.stream_address);
      log({ subscription: row.id, chain_id: row.chain_id, stream: row.stream_address, unstarted_expired: true, tx });
    } catch (e) {
      failed += 1;
      log({ level: "error", subscription: row.id, chain_id: row.chain_id, stream: row.stream_address, error: (e as Error).message });
    }
  }
  return { canceled, failed };
}
