import { sql } from "./client";
import { newId } from "../lib/ids";
import { generateKey, hashKey, parseKey, type KeyKind } from "../lib/keys";

export interface ApiKeyRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  kind: KeyKind;
  name: string;
  last4: string;
}

/**
 * Mint and store a key (FR-API-002). The plaintext is returned to the caller
 * once and is never written anywhere for `sk_`; `pk_` keeps it because a
 * publishable key is meant to be read back by the dashboard. Writes an
 * `audit_log` row (FR-API-006).
 */
export async function createApiKey(input: {
  merchantId: string;
  kind: KeyKind;
  livemode: boolean;
  name: string;
  actor: string;
  ip?: string;
}): Promise<{ row: ApiKeyRow; plaintext: string }> {
  const key = generateKey(input.kind, input.livemode);
  const id = newId("key");
  const row = await sql.begin(async (tx) => {
    const [r] = await tx`
      INSERT INTO api_keys (id, merchant_id, livemode, kind, name, hash, last4, plaintext)
      VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${input.kind}, ${input.name},
              ${key.hash}, ${key.last4}, ${input.kind === "pk" ? key.plaintext : null})
      RETURNING id, merchant_id, livemode, kind, name, last4`;
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip)
             VALUES (${input.merchantId}, ${input.actor}, 'api_key.created', ${id}, ${input.ip ?? null})`;
    return r as ApiKeyRow;
  });
  return { row, plaintext: key.plaintext };
}

/**
 * Resolve a presented key to its row, or null. Checks shape first (cheap,
 * no query for junk), then one indexed lookup by hash, then revocation and
 * grace expiry (FR-API-003, FR-API-105). Stamps `last_used_at`.
 */
export async function authenticateKey(presented: string): Promise<ApiKeyRow | null> {
  if (!parseKey(presented)) return null;
  const hash = hashKey(presented);
  const [row] = await sql`
    UPDATE api_keys SET last_used_at = now()
    WHERE hash = ${hash}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING id, merchant_id, livemode, kind, name, last4`;
  return (row as ApiKeyRow | undefined) ?? null;
}

export interface ApiKeyListRow extends ApiKeyRow {
  plaintext: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
}

const LIST_COLS = sql`id, merchant_id, livemode, kind, name, last4, plaintext, created_at, last_used_at, revoked_at, expires_at`;

/** Both kinds for one merchant and mode, newest first; revoked rows stay for the audit trail (FR-DSH-073). */
export async function listApiKeys(merchantId: string, livemode: boolean): Promise<ApiKeyListRow[]> {
  return (await sql`SELECT ${LIST_COLS} FROM api_keys WHERE merchant_id = ${merchantId} AND livemode = ${livemode}
    ORDER BY kind ASC, created_at DESC`) as ApiKeyListRow[];
}

export async function findApiKey(merchantId: string, livemode: boolean, id: string): Promise<ApiKeyListRow | null> {
  const [row] = await sql`SELECT ${LIST_COLS} FROM api_keys WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as ApiKeyListRow | undefined) ?? null;
}

/** Revoke now (FR-API-003). Returns the row or null. */
export async function revokeApiKey(merchantId: string, livemode: boolean, id: string, actor: string, ip: string | null): Promise<ApiKeyListRow | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx`UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode} AND kind = 'sk'
      RETURNING ${LIST_COLS}`;
    if (!row) return null;
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${merchantId}, ${actor}, 'api_key.revoked', ${id}, ${ip})`;
    return row as ApiKeyListRow;
  });
}

/**
 * FR-API-105: mint a replacement with the same name; the old key keeps working
 * until now + grace (0 revokes it immediately). Returns null when the old key
 * is not an active secret key of this merchant and mode.
 */
export async function rollApiKey(
  merchantId: string,
  livemode: boolean,
  id: string,
  graceSeconds: 0 | 3600 | 86400,
  actor: string,
  ip: string | null,
): Promise<{ row: ApiKeyRow; plaintext: string } | null> {
  const old = await findApiKey(merchantId, livemode, id);
  if (!old || old.kind !== "sk" || old.revoked_at || (old.expires_at && old.expires_at.getTime() <= Date.now())) return null;
  const fresh = await createApiKey({ merchantId, kind: "sk", livemode, name: old.name, actor, ...(ip ? { ip } : {}) });
  await sql.begin(async (tx) => {
    if (graceSeconds === 0) {
      await tx`UPDATE api_keys SET revoked_at = now() WHERE id = ${id}`;
    } else {
      await tx`UPDATE api_keys SET expires_at = now() + make_interval(secs => ${graceSeconds}) WHERE id = ${id}`;
    }
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${merchantId}, ${actor}, 'api_key.rolled', ${id}, ${ip})`;
  });
  return fresh;
}
