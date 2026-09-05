import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { config } from "../config";
import { authenticateKey } from "../db/api-keys";
import { authenticateSession } from "../db/sessions";
import { ApiError, invalid, unauthorized } from "../lib/errors";
import type { KeyKind } from "../lib/keys";

export const SESSION_COOKIE = "elapse_session";

/** What every authenticated handler reads. The mode scopes every query (FR-API-001, BR-API-001). */
export interface Auth {
  merchantId: string;
  livemode: boolean;
  /** `api_key:<id>` or `dashboard`, for the audit log (FR-API-006, FR-API-102). */
  actor: string;
  via: "key" | "session";
  /** Set when `via === "key"`. */
  keyKind?: KeyKind;
  /** Set when `via === "session"`. */
  sessionId?: string;
}

export type AuthEnv = { Variables: { auth: Auth } };

export interface AuthRule {
  /** Which key kinds may pass with `Authorization: Bearer`. Empty = no key auth on this route. */
  keys: readonly KeyKind[];
  /** Whether the dashboard session cookie may pass (FR-API-102). */
  session: boolean;
}

/**
 * One middleware, two credential kinds (FR-API-001, FR-API-004, FR-API-101,
 * FR-API-102). A bearer key sets the mode from its prefix. A session cookie
 * takes the mode from `X-Elapse-Mode` (default `test`) and, on any mutating
 * method, requires `Origin` to be the dashboard's (CSRF) → 403 otherwise.
 * Every failure is one 401 message so the response does not say which.
 */
export function requireAuth(rule: AuthRule) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("authorization");
    if (header !== undefined) {
      if (rule.keys.length === 0) throw unauthorized();
      const m = /^Bearer\s+(\S+)$/i.exec(header);
      if (!m) throw unauthorized("Use 'Authorization: Bearer sk_test_…'.");
      const key = await authenticateKey(m[1]!);
      if (!key || !rule.keys.includes(key.kind)) throw unauthorized();
      c.set("auth", { merchantId: key.merchant_id, livemode: key.livemode, actor: `api_key:${key.id}`, via: "key", keyKind: key.kind });
      return next();
    }

    const cookie = rule.session ? getCookie(c, SESSION_COOKIE) : undefined;
    if (cookie === undefined) {
      throw unauthorized(rule.keys.length ? "You did not provide an API key. Use 'Authorization: Bearer sk_test_…'." : "Sign in to continue.");
    }
    const session = await authenticateSession(cookie);
    if (!session) throw unauthorized("Your session has expired. Sign in again.");
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("origin") !== config.dashboardOrigin) {
      throw new ApiError(403, "authentication_error", "Origin not allowed.");
    }
    const mode = c.req.header("x-elapse-mode") ?? "test";
    if (mode !== "test" && mode !== "live") throw invalid("X-Elapse-Mode must be 'test' or 'live'.", "X-Elapse-Mode");
    c.set("auth", { merchantId: session.merchant_id, livemode: mode === "live", actor: "dashboard", via: "session", sessionId: session.id });
    return next();
  });
}

/** Merchant resources: secret key or dashboard cookie. */
export const merchantAuth = () => requireAuth({ keys: ["sk"], session: true });
/** Dashboard-only concerns (keys, profile): cookie only, never a key (FR-API-003). */
export const sessionAuth = () => requireAuth({ keys: [], session: true });

/** Client IP for rate limits and the audit log; trusts the platform proxy's header. */
export function clientIp(c: { req: { header(name: string): string | undefined } }): string | null {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? null;
}
