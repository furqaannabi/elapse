import { sql } from "../db/client";

export interface DeliveryRow {
  id: string;
  event_id: string;
  endpoint_id: string;
  merchant_id: string;
  livemode: boolean;
  status: "queued" | "retrying" | "succeeded" | "exhausted" | "skipped";
  attempt: number;
  next_attempt_at: Date;
  created_at: Date;
  manual_requested_at: Date | null;
  last_attempt: AttemptRow | null;
}

export interface AttemptRow {
  n: number;
  manual: boolean;
  actor: string | null;
  sent_at: Date;
  duration_ms: number | null;
  status_code: number | null;
  error: string | null;
  request_headers: Record<string, string>;
  response_excerpt: string | null;
}

const ATTEMPT_JSON = sql`(SELECT to_jsonb(a) - 'id' - 'delivery_id' FROM delivery_attempts a WHERE a.delivery_id = d.id ORDER BY a.sent_at DESC LIMIT 1)`;
const COLS = sql`d.id, d.event_id, d.endpoint_id, e.merchant_id, e.livemode, d.status, d.attempt, d.next_attempt_at, d.created_at, d.manual_requested_at,
  ${ATTEMPT_JSON} AS last_attempt`;
const FROM = sql`deliveries d JOIN events e ON e.id = d.event_id`;

/** Scoped through the event's merchant and mode, so foreign ids are 404s (FR-API-082). */
export async function findDelivery(merchantId: string, livemode: boolean, id: string): Promise<DeliveryRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM ${FROM} WHERE d.id = ${id} AND e.merchant_id = ${merchantId} AND e.livemode = ${livemode}`;
  return (row as DeliveryRow | undefined) ?? null;
}

export async function listAttempts(deliveryId: string): Promise<AttemptRow[]> {
  return (await sql`SELECT n, manual, actor, sent_at, duration_ms, status_code, error, request_headers, response_excerpt
    FROM delivery_attempts WHERE delivery_id = ${deliveryId} ORDER BY sent_at ASC`) as AttemptRow[];
}

export class CursorNotFound extends Error {}

export async function listDeliveriesForEndpoint(
  merchantId: string,
  livemode: boolean,
  endpointId: string,
  opts: { limit: number; startingAfter?: string | undefined; eventId?: string | undefined },
): Promise<DeliveryRow[]> {
  const scope = sql`d.endpoint_id = ${endpointId} AND e.merchant_id = ${merchantId} AND e.livemode = ${livemode}
    AND (${opts.eventId ?? null}::text IS NULL OR d.event_id = ${opts.eventId ?? null})`;
  if (opts.startingAfter) {
    const [cursor] = await sql`SELECT d.seq FROM ${FROM} WHERE d.id = ${opts.startingAfter} AND ${scope}`;
    if (!cursor) throw new CursorNotFound(`No such delivery: '${opts.startingAfter}'`);
    return (await sql`SELECT ${COLS} FROM ${FROM} WHERE ${scope} AND d.seq < ${cursor.seq}
      ORDER BY d.seq DESC LIMIT ${opts.limit + 1}`) as DeliveryRow[];
  }
  return (await sql`SELECT ${COLS} FROM ${FROM} WHERE ${scope} ORDER BY d.seq DESC LIMIT ${opts.limit + 1}`) as DeliveryRow[];
}

/** FR-WRK-030: flag the delivery for one manual attempt; the worker picks it up on its next poll. Audit row (FR-WRK-031). */
export async function requestResend(merchantId: string, livemode: boolean, id: string, actor: string): Promise<DeliveryRow | null> {
  const flagged = await sql.begin(async (tx) => {
    const [row] = await tx`
      UPDATE deliveries d SET manual_requested_at = now(), manual_requested_by = ${actor}, updated_at = now()
      FROM events e WHERE e.id = d.event_id AND d.id = ${id} AND e.merchant_id = ${merchantId} AND e.livemode = ${livemode}
      RETURNING d.id`;
    if (!row) return false;
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target) VALUES (${merchantId}, ${actor}, 'delivery.resent', ${id})`;
    return true;
  });
  // Read after commit: the pool connection would not see the transaction's write.
  return flagged ? findDelivery(merchantId, livemode, id) : null;
}
