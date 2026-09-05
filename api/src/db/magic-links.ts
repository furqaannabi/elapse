import { sql } from "./client";
import { hashKey } from "../lib/keys";

const TTL_MINUTES = 15;
const PER_EMAIL_PER_HOUR = 5;
const PER_IP_PER_HOUR = 20;

export class MagicLinkRateLimited extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many sign-in links requested. Try again later.");
  }
}

/**
 * FR-API-100: mint a single-use token valid 15 minutes. Only its SHA-256 is
 * stored. Rate limits are counted in the table itself (5 per email, 20 per IP,
 * per rolling hour), so they hold across API replicas.
 */
export async function issueMagicLink(email: string, ip: string | null): Promise<string> {
  const [counts] = await sql`
    SELECT (SELECT count(*) FROM magic_links WHERE email = ${email} AND created_at > now() - interval '1 hour')::int AS by_email,
           (SELECT count(*) FROM magic_links WHERE ip = ${ip} AND created_at > now() - interval '1 hour')::int AS by_ip,
           (SELECT extract(epoch FROM (min(created_at) + interval '1 hour' - now()))::int FROM magic_links
              WHERE (email = ${email} OR ip = ${ip}) AND created_at > now() - interval '1 hour') AS retry_after`;
  if (counts!.by_email >= PER_EMAIL_PER_HOUR || (ip !== null && counts!.by_ip >= PER_IP_PER_HOUR)) {
    throw new MagicLinkRateLimited(Math.max(1, counts!.retry_after ?? 60));
  }
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await sql`INSERT INTO magic_links (token_hash, email, ip, expires_at)
            VALUES (${hashKey(token)}, ${email}, ${ip}, now() + make_interval(mins => ${TTL_MINUTES}))`;
  return token;
}

/** Consume a token: returns the email once, or null if unknown, used or expired. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const [row] = await sql`
    UPDATE magic_links SET used_at = now()
    WHERE token_hash = ${hashKey(token)} AND used_at IS NULL AND expires_at > now()
    RETURNING email`;
  return (row?.email as string | undefined) ?? null;
}
