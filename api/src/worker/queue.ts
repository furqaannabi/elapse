import { sql } from "../db/client";

/** One claimed delivery with everything an attempt needs (no route code involved). */
export interface Job {
  id: string;
  event_id: string;
  endpoint_id: string;
  merchant_id: string;
  attempt: number;
  locked_until: Date;
  /** True when the previous holder's lock had expired: the crashed attempt is recorded (FR-WRK-015). */
  reclaimed: boolean;
  raw_body: string;
  type: string;
  livemode: boolean;
  url: string;
  disabled: boolean;
  secret_enc: Uint8Array;
  previous_secret_enc: Uint8Array | null;
  previous_secret_expires_at: Date | null;
}

export const LOCK_SECONDS = 60;

/**
 * FR-WRK-010: take up to `batch` due deliveries with `FOR UPDATE SKIP LOCKED`
 * and lock them for 60 s, in one statement, so concurrent workers never
 * share a row. Joins the event bytes and the endpoint's encrypted secrets.
 */
export async function claimDue(batch: number): Promise<Job[]> {
  const rows = await sql`
    WITH due AS (
      SELECT id, locked_until IS NOT NULL AS reclaimed
      FROM deliveries
      WHERE status IN ('queued', 'retrying')
        AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_attempt_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE deliveries d SET locked_until = now() + make_interval(secs => ${LOCK_SECONDS}), updated_at = now()
      FROM due WHERE d.id = due.id
      RETURNING d.id, d.event_id, d.endpoint_id, d.attempt, d.locked_until, due.reclaimed
    )
    SELECT c.id, c.event_id, c.endpoint_id, c.attempt, c.locked_until, c.reclaimed,
           e.merchant_id, e.raw_body, e.type, e.livemode,
           w.url, w.disabled, w.secret_enc, w.previous_secret_enc, w.previous_secret_expires_at
    FROM claimed c
    JOIN events e ON e.id = c.event_id
    JOIN webhook_endpoints w ON w.id = c.endpoint_id
    ORDER BY c.id`;
  return rows as Job[];
}
