import { createMiddleware } from "hono/factory";
import { authenticateKey } from "../db/api-keys";
import { unauthorized } from "../lib/errors";
import type { KeyKind } from "../lib/keys";

/** What every authenticated handler reads. The mode scopes every query (FR-API-001, BR-API-001). */
export interface Auth {
  merchantId: string;
  livemode: boolean;
  /** `api_key:<id>` for the audit log (FR-API-006). Dashboard sessions add `dashboard` later (FR-API-102). */
  actor: string;
  keyKind: KeyKind;
}

export type AuthEnv = { Variables: { auth: Auth } };

/**
 * `Authorization: Bearer sk_…` (FR-API-001). `kinds` lists which key kinds may
 * pass: merchant routes take `["sk"]`, the public checkout read takes
 * `["pk", "sk"]` (FR-API-004). Anything else → 401 `authentication_error`,
 * with one message for malformed, unknown and revoked so the response does
 * not say which.
 */
export function requireKey(kinds: readonly KeyKind[] = ["sk"]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) throw unauthorized("You did not provide an API key. Use 'Authorization: Bearer sk_test_…'.");
    const key = await authenticateKey(m[1]!);
    if (!key || !kinds.includes(key.kind)) throw unauthorized();
    c.set("auth", { merchantId: key.merchant_id, livemode: key.livemode, actor: `api_key:${key.id}`, keyKind: key.kind });
    await next();
  });
}
