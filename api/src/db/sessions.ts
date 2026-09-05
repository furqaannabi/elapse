import { sql } from "./client";
import { newId } from "../lib/ids";
import { hashKey } from "../lib/keys";

export const SESSION_IDLE_DAYS = 7;

/** FR-API-101: opaque cookie value (32 random bytes) whose SHA-256 is the row key. 7-day idle expiry. */
export async function createSession(merchantId: string, ip: string | null): Promise<{ id: string; token: string }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const id = newId("ses");
  await sql`INSERT INTO dashboard_sessions (id, token_hash, merchant_id, ip, expires_at)
            VALUES (${id}, ${hashKey(token)}, ${merchantId}, ${ip}, now() + make_interval(days => ${SESSION_IDLE_DAYS}))`;
  return { id, token };
}

/** Resolve a cookie value to its merchant, sliding the idle expiry. Null when unknown or expired. */
export async function authenticateSession(token: string): Promise<{ id: string; merchant_id: string } | null> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const [row] = await sql`
    UPDATE dashboard_sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_IDLE_DAYS})
    WHERE token_hash = ${hashKey(token)} AND expires_at > now()
    RETURNING id, merchant_id`;
  return (row as { id: string; merchant_id: string } | undefined) ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await sql`DELETE FROM dashboard_sessions WHERE token_hash = ${hashKey(token)}`;
}
