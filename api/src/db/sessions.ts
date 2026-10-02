import { sql } from "./client";
import { newId } from "../lib/ids";
import { hashKey } from "../lib/keys";

export const SESSION_IDLE_DAYS = 7;
/** FR-API-152: a demo session ends this long after it began, however active it is. */
export const DEMO_SESSION_HOURS = 24;

/**
 * FR-API-101: opaque cookie value (32 random bytes) whose SHA-256 is the row key. 7-day idle expiry.
 * A demo session (FR-API-152) is flagged and lives a fixed 24 hours instead.
 */
export async function createSession(merchantId: string, ip: string | null, opts: { demo?: boolean } = {}): Promise<{ id: string; token: string }> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const id = newId("ses");
  const demo = opts.demo === true;
  const life = demo ? sql`make_interval(hours => ${DEMO_SESSION_HOURS})` : sql`make_interval(days => ${SESSION_IDLE_DAYS})`;
  await sql`INSERT INTO dashboard_sessions (id, token_hash, merchant_id, ip, demo, expires_at)
            VALUES (${id}, ${hashKey(token)}, ${merchantId}, ${ip}, ${demo}, now() + ${life})`;
  return { id, token };
}

/** Resolve a cookie value to its merchant, sliding the idle expiry — except a demo session's. Null when unknown or expired. */
export async function authenticateSession(token: string): Promise<{ id: string; merchant_id: string; demo: boolean } | null> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const [row] = await sql`
    UPDATE dashboard_sessions
    SET last_seen_at = now(),
        expires_at = CASE WHEN demo THEN expires_at ELSE now() + make_interval(days => ${SESSION_IDLE_DAYS}) END
    WHERE token_hash = ${hashKey(token)} AND expires_at > now()
    RETURNING id, merchant_id, demo`;
  return (row as { id: string; merchant_id: string; demo: boolean } | undefined) ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await sql`DELETE FROM dashboard_sessions WHERE token_hash = ${hashKey(token)}`;
}
