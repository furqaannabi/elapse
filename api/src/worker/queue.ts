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
  /** Set for a Resend (FR-WRK-030): who asked. The attempt is manual and leaves status and schedule alone. */
  manual_actor: string | null;
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
 * FR-WRK-010: take up to `batch` due deliveries (or ones with a pending
 * Resend, FR-WRK-030) with `FOR UPDATE SKIP LOCKED` and lock them for 60 s,
 * in one statement, so concurrent workers never share a row. Joins the event bytes and the endpoint's encrypted secrets.
 */
export async function claimDue(batch: number): Promise<Job[]> {
  const rows = await sql`
    WITH due AS (
      SELECT id, locked_until IS NOT NULL AS reclaimed, manual_requested_by AS manual_actor
      FROM deliveries
      WHERE ((status IN ('queued', 'retrying') AND next_attempt_at <= now()) OR manual_requested_at IS NOT NULL)
        AND (locked_until IS NULL OR locked_until < now())
        -- FR-API-134: kind = cli Deliveries are streamed by the API to elapse listen, never sent by this worker.
        AND endpoint_id NOT IN (SELECT id FROM webhook_endpoints WHERE kind = 'cli')
      ORDER BY next_attempt_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE deliveries d SET locked_until = now() + make_interval(secs => ${LOCK_SECONDS}),
                              manual_requested_at = NULL, manual_requested_by = NULL, updated_at = now()
      FROM due WHERE d.id = due.id
      RETURNING d.id, d.event_id, d.endpoint_id, d.attempt, d.locked_until, due.reclaimed, due.manual_actor
    )
    SELECT c.id, c.event_id, c.endpoint_id, c.attempt, c.locked_until, c.reclaimed, c.manual_actor,
           e.merchant_id, e.raw_body, e.type, e.livemode,
           w.url, w.disabled, w.secret_enc, w.previous_secret_enc, w.previous_secret_expires_at
    FROM claimed c
    JOIN events e ON e.id = c.event_id
    JOIN webhook_endpoints w ON w.id = c.endpoint_id
    ORDER BY c.id`;
  return rows as Job[];
}
