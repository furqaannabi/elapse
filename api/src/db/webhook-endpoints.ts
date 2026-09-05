import { sql } from "./client";
import { encryptSecret } from "../lib/crypto";
import { newId } from "../lib/ids";
import { generateWebhookSecret } from "../lib/signature";

export interface WebhookEndpointRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  url: string;
  events: string[];
  disabled: boolean;
  previous_secret_expires_at: Date | null;
  created_at: Date;
}

/** `text[]` parameters must be typed explicitly; an untyped JS array is sent as a malformed literal. */
const textArray = (a: string[]) => sql.array(a, "TEXT");

/** Never selects `secret_enc`; the worker has its own read (FR-WRK-023). */
const COLS = sql`id, merchant_id, livemode, url, events, disabled, previous_secret_expires_at, created_at`;

function audit(tx: typeof sql, merchantId: string, actor: string, action: string, target: string) {
  return tx`INSERT INTO audit_log (merchant_id, actor, action, target) VALUES (${merchantId}, ${actor}, ${action}, ${target})`;
}

export async function insertWebhookEndpoint(input: {
  merchantId: string;
  livemode: boolean;
  url: string;
  events: string[];
  actor: string;
}): Promise<{ row: WebhookEndpointRow; secret: string }> {
  const id = newId("wh");
  const secret = generateWebhookSecret();
  const enc = encryptSecret(secret);
  const row = await sql.begin(async (tx) => {
    const [r] = await tx`
      INSERT INTO webhook_endpoints (id, merchant_id, livemode, url, events, secret_enc)
      VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${input.url}, ${textArray(input.events)}, ${enc})
      RETURNING ${COLS}`;
    await audit(tx as unknown as typeof sql, input.merchantId, input.actor, "webhook_endpoint.created", id);
    return r as WebhookEndpointRow;
  });
  return { row, secret };
}

export async function findWebhookEndpoint(merchantId: string, livemode: boolean, id: string): Promise<WebhookEndpointRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM webhook_endpoints WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as WebhookEndpointRow | undefined) ?? null;
}

export class CursorNotFound extends Error {}

export async function listWebhookEndpoints(
  merchantId: string,
  livemode: boolean,
  opts: { limit: number; startingAfter?: string | undefined },
): Promise<WebhookEndpointRow[]> {
  const scope = sql`merchant_id = ${merchantId} AND livemode = ${livemode}`;
  if (opts.startingAfter) {
    const [cursor] = await sql`SELECT created_at, id FROM webhook_endpoints WHERE id = ${opts.startingAfter} AND ${scope}`;
    if (!cursor) throw new CursorNotFound(`No such webhook endpoint: '${opts.startingAfter}'`);
    return (await sql`SELECT ${COLS} FROM webhook_endpoints WHERE ${scope} AND (created_at, id) < (${cursor.created_at}, ${cursor.id})
      ORDER BY created_at DESC, id DESC LIMIT ${opts.limit + 1}`) as WebhookEndpointRow[];
  }
  return (await sql`SELECT ${COLS} FROM webhook_endpoints WHERE ${scope} ORDER BY created_at DESC, id DESC LIMIT ${opts.limit + 1}`) as WebhookEndpointRow[];
}

export async function updateWebhookEndpoint(
  merchantId: string,
  livemode: boolean,
  id: string,
  patch: { url?: string | undefined; events?: string[] | undefined; disabled?: boolean | undefined },
  actor: string,
): Promise<WebhookEndpointRow | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx`
      UPDATE webhook_endpoints SET
        url = COALESCE(${patch.url ?? null}, url),
        events = COALESCE(${patch.events ? textArray(patch.events) : null}, events),
        disabled = COALESCE(${patch.disabled ?? null}, disabled),
        -- Re-enabling clears an auto-disable and its failure streak (FR-WRK-050).
        disabled_reason = CASE WHEN ${patch.disabled === false} THEN NULL ELSE disabled_reason END,
        failing_since = CASE WHEN ${patch.disabled === false} THEN NULL ELSE failing_since END,
        warned_24h_at = CASE WHEN ${patch.disabled === false} THEN NULL ELSE warned_24h_at END,
        updated_at = clock_timestamp()
      WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}
      RETURNING ${COLS}`;
    if (!row) return null;
    await audit(tx as unknown as typeof sql, merchantId, actor, "webhook_endpoint.updated", id);
    return row as WebhookEndpointRow;
  });
}

export async function deleteWebhookEndpoint(merchantId: string, livemode: boolean, id: string, actor: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx`DELETE FROM webhook_endpoints WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode} RETURNING id`;
    if (rows.length === 0) return false;
    await audit(tx as unknown as typeof sql, merchantId, actor, "webhook_endpoint.deleted", id);
    return true;
  });
}

/**
 * FR-API-105: new secret now; the old one keeps signing until now + grace
 * (worker FR-WRK-040). Grace 0 drops it immediately. A second roll inside a
 * window replaces the previous secret, so at most two ever sign.
 */
export async function rollWebhookSecret(
  merchantId: string,
  livemode: boolean,
  id: string,
  graceSeconds: 0 | 3600 | 86400,
  actor: string,
): Promise<{ row: WebhookEndpointRow; secret: string } | null> {
  const secret = generateWebhookSecret();
  const enc = encryptSecret(secret);
  return sql.begin(async (tx) => {
    const [row] = await tx`
      UPDATE webhook_endpoints SET
        previous_secret_enc = CASE WHEN ${graceSeconds} > 0 THEN secret_enc ELSE NULL END,
        previous_secret_expires_at = CASE WHEN ${graceSeconds} > 0 THEN now() + make_interval(secs => ${graceSeconds}) ELSE NULL END,
        secret_enc = ${enc},
        updated_at = clock_timestamp()
      WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}
      RETURNING ${COLS}`;
    if (!row) return null;
    await audit(tx as unknown as typeof sql, merchantId, actor, "webhook_endpoint.secret_rolled", id);
    return { row: row as WebhookEndpointRow, secret };
  });
}
