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
