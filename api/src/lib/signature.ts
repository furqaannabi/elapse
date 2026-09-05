import { createHmac } from "node:crypto";
import { randomBase62 } from "./ids";

/**
 * `X-Elapse-Signature` (CLAUDE.md, worker FR-WRK-020/021): `t=<unix>,v1=<hex>`
 * where `v1 = HMAC_SHA256(secret, "${t}.${rawBody}")`, lowercase hex, no
 * spaces. During a secret roll every active secret signs, newest first, so
 * the old secret's `v1` is last for SDKs that read only the last value
 * (FR-WRK-041). The bytes signed are the bytes sent: callers pass
 * `events.raw_body` unchanged.
 */
export function signPayload(rawBody: string, secrets: readonly string[], t: number): string {
  if (secrets.length === 0) throw new Error("signPayload needs at least one secret");
  const sigs = secrets.map((s) => `v1=${createHmac("sha256", s).update(`${t}.${rawBody}`).digest("hex")}`);
  return `t=${t},${sigs.join(",")}`;
}

/** `whsec_` + 32 base62 chars (~190 bits). Shown once (BR-API-003). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBase62(32)}`;
}
