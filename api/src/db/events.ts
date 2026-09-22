import type { SQL } from "bun";
import { sql } from "./client";
import { newId } from "../lib/ids";
import { isEventType, type EventType } from "../lib/event-types";

/** §5.3 wire object. `pending_webhooks` is recomputed on read (FR-API-063). */
export interface EventObject {
  id: string;
  object: "event";
  type: EventType;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
  pending_webhooks: number;
  request?: { id: string | null; idempotency_key: string | null };
}

export interface EventRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  type: EventType;
  data: { object: Record<string, unknown> };
  raw_body: string;
  created: Date;
  request: EventObject["request"] | null;
  pending: number;
  /** Rolled up from the event's deliveries (dashboard FR-DSH-023): none/any pending → pending; all finished and any exhausted → failed; else delivered. */
  delivery_state: "pending" | "delivered" | "failed" | "not_sent";
  /** FR-API-136: product name and customer email resolved from the payload's ids (through the subscription for invoices); null when nothing resolves. Dashboard sessions only. */
  context: EventContext | null;
}

export interface EventContext {
  product_name: string;
  /** The `cus_` id, so the dashboard can name a customer who has no email. */
  customer: string;
  customer_email: string | null;
  /** Invoice events only: what the customer paid for the period (`data.object.amount_settled`). */
  amount_settled?: string;
}

/** A transaction handle or the pool itself; both are `SQL`. */
type Tx = SQL;

/**
 * Create an Event and its Delivery jobs in one transaction (FR-API-073,
 * worker FR-WRK-001). `raw_body` is `JSON.stringify` of the object exactly as
 * returned here; the worker signs and sends those bytes unchanged.
 *
 * `onlyEndpointId` restricts fan-out to one endpoint regardless of its
 * subscription (the `…/test` action). Otherwise every enabled endpoint of the
 * merchant in the same mode whose `events` contains the type or `"*"` gets a job.
 */
export async function createEvent(input: {
  merchantId: string;
  livemode: boolean;
  type: EventType;
  object: Record<string, unknown>;
  chainEventId?: number | undefined;
  request?: EventObject["request"] | undefined;
  onlyEndpointId?: string | undefined;
  tx?: Tx | undefined;
}): Promise<EventObject> {
  if (!isEventType(input.type)) throw new Error(`Unknown event type: ${input.type}`);
  const run = async (tx: Tx): Promise<EventObject> => {
    const endpoints = input.onlyEndpointId
      ? await tx`SELECT id FROM webhook_endpoints WHERE id = ${input.onlyEndpointId} AND merchant_id = ${input.merchantId} AND livemode = ${input.livemode}`
      : await tx`SELECT id FROM webhook_endpoints
           WHERE merchant_id = ${input.merchantId} AND livemode = ${input.livemode} AND disabled = false
             AND (${input.type} = ANY(events) OR '*' = ANY(events))
             -- FR-API-134: the CLI endpoint receives a Delivery only while elapse listen is connected.
             AND (kind = 'http' OR cli_connected_until > now())`;
    const id = newId("evt");
    const created = Math.floor(Date.now() / 1000);
    const event: EventObject = {
      id,
      object: "event",
      type: input.type,
      created,
      livemode: input.livemode,
      data: { object: input.object },
      pending_webhooks: endpoints.length,
      ...(input.request ? { request: input.request } : {}),
    };
    const raw = JSON.stringify(event);
    await tx`INSERT INTO events (id, merchant_id, livemode, type, data, raw_body, created, pending_webhooks, chain_event_id, request)
             VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${input.type}, ${event.data}, ${raw},
                     to_timestamp(${created}), ${endpoints.length}, ${input.chainEventId ?? null}, ${input.request ?? null})`;
    for (const ep of endpoints) {
      await tx`INSERT INTO deliveries (id, event_id, endpoint_id) VALUES (${newId("dlv")}, ${id}, ${ep.id})`;
    }
    return event;
  };
  return input.tx ? run(input.tx) : sql.begin(run);
}

/**
 * FR-API-146: "delivered" is a claim about the world, so the rollup only makes it when a Delivery
 * actually succeeded. Two things used to fall into the old ELSE although nothing reached the
 * merchant: an event with no Deliveries at all (fan-out matched nothing — a disconnected CLI
 * endpoint is excluded by FR-API-134), and one whose every Delivery was skipped (cli_not_acked,
 * endpoint_disabled). Both read "not_sent": this did not reach you, and nothing is still trying.
 *
 * An event with several endpoints still reads "delivered" when any one of them succeeded; the
 * per-Delivery list is where a partial failure shows.
 */
const COLS = sql`e.id, e.merchant_id, e.livemode, e.type, e.data, e.raw_body, e.created, e.request,
  (SELECT count(*)::int FROM deliveries d WHERE d.event_id = e.id AND d.status NOT IN ('succeeded', 'exhausted', 'skipped')) AS pending,
  (SELECT CASE
     WHEN count(*) FILTER (WHERE d.status IN ('queued', 'retrying')) > 0 THEN 'pending'
     WHEN count(*) FILTER (WHERE d.status = 'succeeded') > 0 THEN 'delivered'
     WHEN count(*) FILTER (WHERE d.status = 'exhausted') > 0 THEN 'failed'
     ELSE 'not_sent' END
   FROM deliveries d WHERE d.event_id = e.id) AS delivery_state,
  (SELECT jsonb_build_object('product_name', p.name, 'customer', c.id, 'customer_email', c.email)
     || CASE WHEN e.type LIKE 'invoice.%' AND e.data->'object'->>'amount_settled' IS NOT NULL
             THEN jsonb_build_object('amount_settled', e.data->'object'->>'amount_settled') ELSE '{}'::jsonb END
   FROM subscriptions s JOIN products p ON p.id = s.product_id JOIN customers c ON c.id = s.customer_id
   WHERE s.merchant_id = e.merchant_id AND s.livemode = e.livemode
     AND s.id = COALESCE(e.data->'object'->>'subscription', CASE WHEN e.data->'object'->>'object' = 'subscription' THEN e.data->'object'->>'id' END)
   LIMIT 1) AS context`;

export function serializeEvent(r: EventRow): EventObject {
  return {
    id: r.id,
    object: "event",
    type: r.type,
    created: Math.floor(r.created.getTime() / 1000),
    livemode: r.livemode,
    data: r.data,
    pending_webhooks: r.pending,
    ...(r.request ? { request: r.request } : {}),
  };
}

/**
 * The event as the API returns it on reads: the §5.3 object plus two dashboard conveniences.
 * Never used for webhook bodies, which are the stored `raw_body` bytes (FR-WRK-021).
 */
/** The read shape (FR-API-063 + dashboard fields). `context` (FR-API-136) is attached only when `withContext` is set: dashboard sessions, never API keys. */
export function serializeEventForRead(r: EventRow, withContext = false) {
  return {
    ...serializeEvent(r),
    object_id: typeof r.data.object.id === "string" ? (r.data.object.id as string) : null,
    delivery_state: r.delivery_state,
    ...(withContext ? { context: r.context } : {}),
  };
}

export async function findEvent(merchantId: string, livemode: boolean, id: string): Promise<EventRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM events e WHERE e.id = ${id} AND e.merchant_id = ${merchantId} AND e.livemode = ${livemode}`;
  return (row as EventRow | undefined) ?? null;
}

export class CursorNotFound extends Error {}

export async function listEvents(
  merchantId: string,
  livemode: boolean,
  opts: { limit: number; startingAfter?: string | undefined; type?: EventType | undefined; since?: number | undefined; until?: number | undefined },
): Promise<EventRow[]> {
  const scope = sql`e.merchant_id = ${merchantId} AND e.livemode = ${livemode} AND (${opts.type ?? null}::text IS NULL OR e.type = ${opts.type ?? null})
    AND (${opts.since ?? null}::bigint IS NULL OR e.created >= to_timestamp(${opts.since ?? null}))
    AND (${opts.until ?? null}::bigint IS NULL OR e.created <= to_timestamp(${opts.until ?? null}))`;
  if (opts.startingAfter) {
    const [cursor] = await sql`SELECT seq FROM events e WHERE e.id = ${opts.startingAfter} AND ${scope}`;
    if (!cursor) throw new CursorNotFound(`No such event: '${opts.startingAfter}'`);
    return (await sql`SELECT ${COLS} FROM events e WHERE ${scope} AND e.seq < ${cursor.seq}
      ORDER BY e.seq DESC LIMIT ${opts.limit + 1}`) as EventRow[];
  }
  return (await sql`SELECT ${COLS} FROM events e WHERE ${scope} ORDER BY e.seq DESC LIMIT ${opts.limit + 1}`) as EventRow[];
}
