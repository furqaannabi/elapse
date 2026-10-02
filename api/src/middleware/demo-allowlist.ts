/**
 * What a demo session may write (FR-API-153, BR-API-010, ADR 2026-10-02 demo account).
 *
 * Deny by default: a mutating request on a demo session passes only if its method and path are
 * named here **and** the mode is test. Every live-mode write, the profile, the payout address, the
 * logo, Delete test data — and any route added later — is refused until someone adds it on purpose.
 * Reads are never refused. The auth middleware applies it, so it covers every cookie-authenticated
 * route without each one remembering to.
 */
const ID = "[^/]+";

const ALLOWLIST: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["POST", new RegExp(`^/v1/products$`)], // create
  ["POST", new RegExp(`^/v1/products/${ID}$`)], // update, archive
  ["POST", new RegExp(`^/v1/checkout/sessions$`)],
  ["POST", new RegExp(`^/v1/webhook_endpoints$`)],
  ["POST", new RegExp(`^/v1/webhook_endpoints/${ID}$`)],
  ["DELETE", new RegExp(`^/v1/webhook_endpoints/${ID}$`)],
  ["POST", new RegExp(`^/v1/webhook_endpoints/${ID}/(roll_secret|test)$`)],
  ["POST", new RegExp(`^/v1/(events|deliveries)/${ID}/resend$`)],
  ["POST", new RegExp(`^/v1/dashboard/notifications/read_all$`)],
  ["POST", new RegExp(`^/v1/dashboard/faucet$`)],
  ["POST", new RegExp(`^/v1/api_keys$`)],
  ["POST", new RegExp(`^/v1/api_keys/${ID}/roll$`)],
  ["DELETE", new RegExp(`^/v1/api_keys/${ID}$`)],
];

export const DEMO_REFUSAL = "Not available in the demo account. Sign in with your email to use it.";

/** Whether a demo session may make this request. */
export function demoMayWrite(method: string, path: string, livemode: boolean): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (livemode) return false;
  return ALLOWLIST.some(([m, re]) => m === method && re.test(path));
}
