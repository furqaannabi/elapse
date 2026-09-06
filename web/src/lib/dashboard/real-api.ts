/**
 * The real `DashboardApi` (dashboard FRD FR-DSH-110; API FRD FR-API-100..103, FR-API-003,
 * FR-API-060..064). Cookie-authenticated: every call carries `credentials: "include"`, the
 * mode header, and an `Idempotency-Key` on writes (FR-DSH-112). Snake_case wire objects
 * become the dashboard's types here and nowhere else.
 *
 * Every `DashboardApi` method is served (2026-09-06): auth, profile, home, keys, webhooks,
 * deliveries, events, products, subscriptions, customers, invoices, ledger, balance, payout
 * address, notifications, activity, search, delete test data.
 */
import { DashboardApiError as MockError, type DashboardApi, type WriteOpts } from "./mock-api";
import { newIdempotencyKey } from "./idempotency";
import type {
  ApiKey, Attempt, AuditAction, AuditEntry, Balance, ChecklistState, Customer, Delivery, DeliveryStatus, Event, EventType, Invoice, KeyList, KeyStatus, LedgerEntry, Merchant, Mode, Notification, NotificationKind, Overview, Product, Subscription, WebhookEndpoint,
} from "./types";

/**
 * Errors reuse the mock's class and code vocabulary so every page's handling (redirect on
 * `unauthenticated`, "not found" panels, link states on verify) works unchanged. The HTTP
 * status, the API's own code and the offending `param` ride along for forms.
 */
export class DashboardApiError extends MockError {
  constructor(
    code: ConstructorParameters<typeof MockError>[0],
    message: string,
    public readonly status = 0,
    public readonly apiCode?: string,
    public readonly param?: string,
  ) {
    super(code, message);
  }
}

/** HTTP status + API code → the page vocabulary. */
function codeFor(status: number, apiCode: string | undefined, path: string): ConstructorParameters<typeof MockError>[0] {
  if (status === 401) return path.includes("/auth/verify") ? "link_invalid" : "unauthenticated";
  if (status === 404) return "not_found";
  if (status === 409) return "invalid_state";
  if (status === 400) return "invalid_input";
  if (status >= 500 || status === 0) return "network";
  return "invalid_state";
}

// ─── wire shapes ──────────────────────────────────────────────────────────────

type WireProfile = {
  id: string; name: string | null; email: string; support_email: string | null; support_url: string | null; payout_address: string | null; fee_bps: number;
  branding: { display_name: string | null; logo_url: string | null; accent: string | null; support_url: string | null };
  notifications: { endpoint_exhausted_email: boolean; key_expiry_email: boolean };
  checklist: { key_created: boolean; product_created: boolean; endpoint_created: boolean; first_delivery_succeeded: boolean };
  created: number;
};
type WireKey = { id: string; kind: "sk" | "pk"; name: string; livemode: boolean; last4: string; redacted: string; publishable_key?: string; created: number; last_used_at: number | null; revoked_at: number | null; expires_at: number | null; secret?: string };
type WireEndpoint = { id: string; url: string; events: string[]; disabled: boolean; livemode: boolean; created: number; previous_secret_expires_at: number | null; success_rate_7d: number; secret?: string };
type WireAttempt = { n: number; manual: boolean; actor: string | null; sent_at: number; duration_ms: number | null; status_code: number | null; error: string | null; request_headers: Record<string, string>; response_excerpt: string | null };
type WireDelivery = { id: string; event: string; endpoint: string; status: "queued" | "retrying" | "succeeded" | "exhausted" | "skipped"; attempt: number; next_attempt_at: number | null; livemode: boolean; created: number; resend_requested: boolean; max_attempts: number; event_type: string; event_created: number; endpoint_url: string; endpoint_disabled?: boolean; attempts_made?: number; last_attempt?: WireAttempt | null; attempts?: WireAttempt[] };
type WireEvent = { id: string; type: EventType; created: number; livemode: boolean; data: { object: Record<string, unknown> }; pending_webhooks: number; object_id: string | null; delivery_state: "pending" | "delivered" | "failed"; deliveries?: WireDelivery[] };
type WireProduct = { id: string; name: string; description: string | null; rate_usd_per_second: string; allow_pause: boolean; active: boolean; livemode: boolean; created: number; active_subscriptions: number };
type WireSubscription = {
  id: string; status: Subscription["status"]; product: string; customer: string; checkout_session: string | null; rate_usd_per_second: string;
  started_at: number | null; paused_at: number | null; canceled_at: number | null; ended_reason: "canceled" | "cap_reached" | null;
  max_duration_seconds: number; max_escrow_usd: string; funded_usd: string; settled_usd: string; seconds_elapsed: number; stream_address: string | null;
  chain_id: number; livemode: boolean; created: number; product_name: string; customer_email: string | null;
};
type WireInvoice = { id: string; subscription: string; customer: string; period_start: number; period_end: number; seconds: number; amount_settled: string; gross: string; fee: string; net: string; status: "paid" | "failed"; tx_hash: string; livemode: boolean; created: number };
type WireOverview = { running_now: number; accrued_today_usd: string; settled_week_net_usd: string; failed_payments_week: number; running: WireSubscription[]; recent_events: WireEvent[]; as_of: number };
type WireCustomer = { id: string; email: string | null; wallet_address: string; livemode: boolean; created: number; subscription_count: number; total_settled_usd: string };
type WireLedger = { id: string; kind: LedgerEntry["kind"]; amount_usd: string; subscription: string; customer: string; customer_email: string | null; tx_hash: string; log_index: number; block_timestamp: number; reversed_by: string | null; livemode: boolean };
type WireNotification = { id: string; kind: string; summary: string; target_id: string | null; created: number; read_at: number | null; emailed_at: number | null; livemode: boolean };
type WireAudit = { id: string; at: number; actor: string; action: string; target: string | null; ip: string | null };
type List<T> = { object: "list"; data: T[]; has_more: boolean };

// ─── mapping ──────────────────────────────────────────────────────────────────

const ms = (s: number | null | undefined): number | null => (s === null || s === undefined ? null : s * 1000);

export function mapMerchant(w: WireProfile): Merchant {
  return {
    id: w.id as Merchant["id"],
    email: w.email,
    name: w.name,
    supportEmail: w.support_email,
    supportUrl: w.support_url,
    payoutAddress: w.payout_address,
    feeBps: w.fee_bps,
    branding: {
      name: w.branding.display_name ?? w.name ?? "",
      ...(w.branding.logo_url ? { logoUrl: w.branding.logo_url } : {}),
      ...(w.branding.accent ? { accent: w.branding.accent } : {}),
      ...(w.branding.support_url ? { supportUrl: w.branding.support_url } : {}),
    },
    createdAt: w.created * 1000,
  };
}

export function mapChecklist(w: WireProfile["checklist"]): ChecklistState {
  return { hasProduct: w.product_created, hasSecretKey: w.key_created, hasEndpoint: w.endpoint_created, hasSucceededDelivery: w.first_delivery_succeeded };
}

export function keyStatus(k: { revoked_at: number | null; expires_at: number | null }, now = Date.now()): KeyStatus {
  if (k.revoked_at !== null) return "revoked";
  if (k.expires_at !== null) return k.expires_at * 1000 <= now ? "expired" : "expiring";
  return "active";
}

export function mapKey(w: WireKey, now = Date.now()): ApiKey {
  return {
    id: w.id as ApiKey["id"],
    livemode: w.livemode,
    name: w.name,
    // The API keeps only a hash and the last four, so the recognisable part is the kind and mode.
    prefix: `${w.kind}_${w.livemode ? "live" : "test"}_`,
    last4: w.last4,
    createdAt: w.created * 1000,
    lastUsedAt: ms(w.last_used_at),
    revokedAt: ms(w.revoked_at),
    expiresAt: ms(w.expires_at),
    status: keyStatus(w, now),
  };
}

export function mapEndpoint(w: WireEndpoint): WebhookEndpoint {
  return {
    id: w.id as WebhookEndpoint["id"],
    livemode: w.livemode,
    url: w.url,
    events: w.events.includes("*") ? "*" : (w.events as EventType[]),
    disabled: w.disabled,
    successRate7d: w.success_rate_7d,
    previousSecretExpiresAt: ms(w.previous_secret_expires_at),
    createdAt: w.created * 1000,
  };
}

const deliveryStatus = (s: WireDelivery["status"]): DeliveryStatus =>
  s === "queued" || s === "retrying" ? "pending" : s === "succeeded" ? "succeeded" : s === "exhausted" ? "exhausted" : "skipped";

export function mapAttempt(a: WireAttempt, requestBody: string): Attempt {
  return {
    at: a.sent_at * 1000,
    manual: a.manual,
    requestHeaders: a.request_headers ?? {},
    requestBody,
    responseCode: a.status_code,
    responseBody: a.response_excerpt,
    error: a.error,
  };
}

export function mapDelivery(w: WireDelivery, requestBody = ""): Delivery {
  const attempts = w.attempts ?? (w.last_attempt ? [w.last_attempt] : []);
  const last = attempts[attempts.length - 1] ?? null;
  // A retrying delivery whose last attempt failed reads as "failed" in the table (FR-DSH-083).
  const status: DeliveryStatus = w.status === "retrying" && last && (last.status_code === null || last.status_code >= 300) ? "failed" : deliveryStatus(w.status);
  return {
    id: w.id as Delivery["id"],
    livemode: w.livemode,
    event: { id: w.event as Event["id"], type: w.event_type as EventType, objectId: "", createdAt: w.event_created * 1000 },
    endpoint: { id: w.endpoint as WebhookEndpoint["id"], url: w.endpoint_url },
    status,
    attempt: w.attempt,
    attemptsMade: w.attempts_made ?? attempts.length,
    endpointDisabled: w.endpoint_disabled ?? false,
    maxAttempts: 8,
    lastResponseCode: last?.status_code ?? null,
    nextAttemptAt: ms(w.next_attempt_at),
    attempts: attempts.map((a) => mapAttempt(a, requestBody)),
  };
}

export function mapEvent(w: WireEvent): Event {
  return {
    id: w.id as Event["id"],
    livemode: w.livemode,
    type: w.type,
    objectId: w.object_id ?? "",
    createdAt: w.created * 1000,
    pendingWebhooks: w.pending_webhooks,
    deliveryState: w.delivery_state,
    payload: w.data.object,
  };
}

export function mapProduct(w: WireProduct): Product {
  return {
    id: w.id as Product["id"],
    livemode: w.livemode,
    name: w.name,
    description: w.description,
    rateUsdPerSecond: w.rate_usd_per_second,
    allowPause: w.allow_pause,
    status: w.active ? "active" : "archived",
    activeSubscriptions: w.active_subscriptions,
    createdAt: w.created * 1000,
  };
}

export function mapSubscription(w: WireSubscription): Subscription {
  return {
    id: w.id as Subscription["id"],
    livemode: w.livemode,
    status: w.status,
    product: { id: w.product as Product["id"], name: w.product_name },
    customer: { id: w.customer as `cus_${string}`, email: w.customer_email },
    rateUsdPerSecond: w.rate_usd_per_second,
    startedAt: ms(w.started_at),
    pausedAt: ms(w.paused_at),
    canceledAt: ms(w.canceled_at),
    ...(w.status === "paused" ? { pauseReason: "user" as const } : {}),
    ...(w.ended_reason ? { endedReason: w.ended_reason } : {}),
    fundedUsd: w.max_escrow_usd,
    settledUsd: w.settled_usd,
    checkoutSession: (w.checkout_session ?? "cs_") as `cs_${string}`,
    createdAt: w.created * 1000,
  };
}

export function mapInvoice(w: WireInvoice, customerEmail: string | null = null): Invoice {
  return {
    id: w.id as Invoice["id"],
    livemode: w.livemode,
    subscription: w.subscription as `sub_${string}`,
    customer: { id: w.customer as `cus_${string}`, email: customerEmail },
    settledAt: w.period_end * 1000,
    seconds: w.seconds,
    grossUsd: w.gross,
    feeUsd: w.fee,
    netUsd: w.net,
    txId: w.tx_hash,
  };
}

/** Whole-second receipt from the ended subscription's own numbers (BR-DSH-003). */
export function receiptOf(w: WireSubscription) {
  const scale = 1_000_000n; // 6-decimal token math, no floats
  const toUnits = (d: string) => {
    const [i, f = ""] = d.split(".");
    return BigInt(i ?? "0") * scale + BigInt((f + "000000").slice(0, 6));
  };
  const fmt = (n: bigint) => {
    const s = n.toString().padStart(7, "0");
    const frac = s.slice(-6).replace(/0+$/, "");
    return frac ? `${s.slice(0, -6)}.${frac}` : s.slice(0, -6);
  };
  const refunded = toUnits(w.max_escrow_usd) - toUnits(w.settled_usd);
  return { secondsElapsed: w.seconds_elapsed, amountSettledUsd: w.settled_usd, refundedUsd: fmt(refunded < 0n ? 0n : refunded), canceledAt: (w.canceled_at ?? 0) * 1000 };
}

export function mapCustomer(w: WireCustomer): Customer {
  return { id: w.id as Customer["id"], livemode: w.livemode, email: w.email, createdAt: w.created * 1000, totalSettledUsd: w.total_settled_usd, subscriptionCount: w.subscription_count };
}

export function mapLedger(w: WireLedger): LedgerEntry {
  return {
    id: w.id as LedgerEntry["id"], livemode: w.livemode, kind: w.kind, amountUsd: w.amount_usd, subscription: w.subscription as `sub_${string}`,
    customer: { id: w.customer as `cus_${string}`, email: w.customer_email }, txId: w.tx_hash, blockTime: w.block_timestamp * 1000,
    reversedBy: w.reversed_by as LedgerEntry["reversedBy"], invoice: null,
  };
}

/** API notification kinds → the page's; `endpoint_failing` reads as the exhausted family, `first_delivery_succeeded` as `first_delivery`. */
function notificationKind(k: string): NotificationKind {
  if (k === "endpoint_failing" || k === "endpoint_exhausted") return "endpoint_exhausted";
  if (k === "first_delivery_succeeded") return "first_delivery";
  return (["key_expiring", "secret_expiring", "payment_failed"].includes(k) ? k : "payment_failed") as NotificationKind;
}
const hrefFor = (kind: string, target: string | null): string => {
  if (!target) return "/dashboard";
  if (target.startsWith("wh_")) return `/dashboard/developers/webhooks/${target}`;
  if (target.startsWith("key_")) return "/dashboard/developers/keys";
  if (target.startsWith("sub_")) return `/dashboard/subscriptions/${target}`;
  return "/dashboard";
};
export function mapNotification(w: WireNotification): Notification {
  return { id: w.id as Notification["id"], livemode: w.livemode, kind: notificationKind(w.kind), summary: w.summary, objectId: w.target_id ?? "", href: hrefFor(w.kind, w.target_id), createdAt: w.created * 1000, readAt: ms(w.read_at), emailedAt: ms(w.emailed_at) };
}

const AUDIT_ACTIONS: Record<string, AuditAction> = {
  sign_in: "signin", "api_key.created": "key.created", "api_key.rolled": "key.rolled", "api_key.revoked": "key.revoked",
  "webhook_endpoint.created": "endpoint.added", "webhook_endpoint.updated": "endpoint.changed", "webhook_endpoint.secret_rolled": "secret.rolled",
  "webhook_endpoint.auto_disabled": "endpoint.disabled", "webhook_endpoint.deleted": "endpoint.changed", payout_address_changed: "payout_address.changed",
  "delivery.resent": "delivery.resent", "test_data.deleted": "test_data.deleted",
};
const AUDIT_TO_API: Partial<Record<AuditAction, string>> = Object.fromEntries(Object.entries(AUDIT_ACTIONS).map(([k, v]) => [v, k]));
export function mapAudit(w: WireAudit): AuditEntry | null {
  const action = AUDIT_ACTIONS[w.action];
  if (!action) return null; // merchant.onboarded / merchant.updated have no row in the page's vocabulary
  return { id: w.id as AuditEntry["id"], at: w.at * 1000, actor: w.actor, action, target: w.target ?? "", ip: w.ip ?? "" };
}

// ─── client ───────────────────────────────────────────────────────────────────

export interface RealDashboardOptions {
  baseUrl: string;
  /** Test hook: the mode is otherwise read per call. */
  getMode?: () => Mode;
  /** Where a "Copy Checkout URL" session returns the subscriber (FR-DSH-032): the dashboard itself. */
  dashboardOrigin?: string;
}

export function createRealDashboardApi(o: RealDashboardOptions): DashboardApi {
  let currentMode: Mode = "test";
  const modeOf = (m?: Mode) => m ?? o.getMode?.() ?? currentMode;

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, opts: { body?: unknown; mode?: Mode; idempotencyKey?: string | undefined } = {}): Promise<T> {
    const headers: Record<string, string> = { "x-elapse-mode": modeOf(opts.mode) };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["idempotency-key"] = opts.idempotencyKey ?? newIdempotencyKey();
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}${path}`, { method, headers, credentials: "include", body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch {
      throw new DashboardApiError("network", "We couldn't reach Elapse. Check your connection and try again.", 0);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as { error?: { code?: string; message?: string; param?: string } }) : null;
    if (!res.ok) throw new DashboardApiError(codeFor(res.status, json?.error?.code, path), json?.error?.message ?? "Something went wrong.", res.status, json?.error?.code, json?.error?.param);
    return json as T;
  }
  const idem = (opts?: WriteOpts) => opts?.idempotencyKey;

  return {
    // ── auth (FR-DSH-010..014) ──
    async requestMagicLink(email) {
      const r = await call<{ sent: true; dev_token?: string }>("POST", "/v1/dashboard/auth/magic_link", { body: { email } });
      return r.dev_token ? { sent: true, devToken: r.dev_token } : { sent: true };
    },
    async verifyMagicLink(token) {
      await call("POST", "/v1/dashboard/auth/verify", { body: { token } });
      return mapMerchant(await call<WireProfile>("GET", "/v1/dashboard/me"));
    },
    async me() {
      return mapMerchant(await call<WireProfile>("GET", "/v1/dashboard/me"));
    },
    async completeFirstRun(input) {
      return mapMerchant(await call<WireProfile>("POST", "/v1/dashboard/me", { body: { name: input.name, ...(input.payoutAddress ? { payout_address: input.payoutAddress } : {}) } }));
    },
    async signOut() {
      await call("POST", "/v1/dashboard/auth/sign_out");
    },

    // ── home ──
    async checklist(mode) {
      currentMode = mode;
      return mapChecklist((await call<WireProfile>("GET", "/v1/dashboard/me", { mode })).checklist);
    },
    async overview(mode) {
      currentMode = mode;
      const o = await call<WireOverview>("GET", "/v1/dashboard/overview", { mode });
      return {
        runningNow: o.running_now,
        accruedTodayUsd: o.accrued_today_usd,
        settledWeekNetUsd: o.settled_week_net_usd,
        failedPaymentsWeek: o.failed_payments_week,
        running: o.running.map(mapSubscription),
        recentEvents: o.recent_events.map(mapEvent),
      } satisfies Overview;
    },

    // ── keys (FR-DSH-070..074) ──
    async listKeys(mode) {
      currentMode = mode;
      const r = await call<List<WireKey>>("GET", "/v1/api_keys", { mode });
      const pk = r.data.find((k) => k.kind === "pk" && k.publishable_key);
      return { publishable: pk?.publishable_key ?? "", secret: r.data.filter((k) => k.kind === "sk").map((k) => mapKey(k)) };
    },
    async createKey(mode, name, opts) {
      const k = await call<WireKey>("POST", "/v1/api_keys", { mode, body: { name }, idempotencyKey: idem(opts) });
      return { key: mapKey(k), secret: k.secret ?? "" };
    },
    async rollKey(id, opts) {
      const grace = opts.graceMs >= 86_400_000 ? 86400 : opts.graceMs >= 3_600_000 ? 3600 : 0;
      const k = await call<WireKey>("POST", `/v1/api_keys/${id}/roll`, { body: { grace }, idempotencyKey: idem(opts) });
      return { key: mapKey(k), secret: k.secret ?? "" };
    },
    async revokeKey(id, opts) {
      return mapKey(await call<WireKey>("DELETE", `/v1/api_keys/${id}`, { idempotencyKey: idem(opts) }));
    },

    // ── webhooks (FR-DSH-080..085) ──
    async listEndpoints(mode) {
      currentMode = mode;
      return (await call<List<WireEndpoint>>("GET", "/v1/webhook_endpoints?limit=100", { mode })).data.map(mapEndpoint);
    },
    async createEndpoint(mode, input, opts) {
      const w = await call<WireEndpoint>("POST", "/v1/webhook_endpoints", { mode, body: { url: input.url, events: input.events === "*" ? ["*"] : input.events }, idempotencyKey: idem(opts) });
      return { endpoint: mapEndpoint(w), secret: w.secret ?? "" };
    },
    async updateEndpoint(id, input, opts) {
      const body: Record<string, unknown> = {};
      if (input.url !== undefined) body.url = input.url;
      if (input.events !== undefined) body.events = input.events === "*" ? ["*"] : input.events;
      if (input.disabled !== undefined) body.disabled = input.disabled;
      return mapEndpoint(await call<WireEndpoint>("POST", `/v1/webhook_endpoints/${id}`, { body, idempotencyKey: idem(opts) }));
    },
    async rollEndpointSecret(id, opts) {
      const grace = opts.graceMs >= 86_400_000 ? 86400 : opts.graceMs >= 3_600_000 ? 3600 : 0;
      const w = await call<WireEndpoint>("POST", `/v1/webhook_endpoints/${id}/roll_secret`, { body: { grace }, idempotencyKey: idem(opts) });
      return { endpoint: mapEndpoint(w), secret: w.secret ?? "" };
    },
    async sendTestEvent(id, type, opts) {
      const ev = await call<WireEvent>("POST", `/v1/webhook_endpoints/${id}/test`, { body: { type }, idempotencyKey: idem(opts) });
      const full = await call<WireEvent>("GET", `/v1/events/${ev.id}`);
      const d = (full.deliveries ?? []).find((x) => x.endpoint === id) ?? full.deliveries?.[0];
      if (!d) throw new DashboardApiError("invalid_state", "The test event was created but no delivery was queued.", 500, "no_delivery");
      return { event: mapEvent(full), delivery: mapDelivery(d, JSON.stringify(full)) };
    },

    // ── deliveries (FR-DSH-083..085) ──
    async listDeliveries(endpointId, filter) {
      const q = filter?.status ? `?status=${filter.status === "pending" ? "queued" : filter.status}&limit=100` : "?limit=100";
      return (await call<List<WireDelivery>>("GET", `/v1/webhook_endpoints/${endpointId}/deliveries${q}`)).data.map((d) => mapDelivery(d));
    },
    async getDelivery(id) {
      const d = await call<WireDelivery>("GET", `/v1/deliveries/${id}`);
      const ev = await call<WireEvent>("GET", `/v1/events/${d.event}`);
      const { deliveries: _omit, ...signed } = ev;
      const out = mapDelivery(d, JSON.stringify(signed));
      out.event.objectId = ev.object_id ?? "";
      return out;
    },
    async resendDelivery(id, opts) {
      await call("POST", `/v1/deliveries/${id}/resend`, { idempotencyKey: idem(opts) });
      return mapDelivery(await call<WireDelivery>("GET", `/v1/deliveries/${id}`));
    },

    // ── events (FR-DSH-090..092) ──
    async listEvents(mode, filter) {
      currentMode = mode;
      const q = new URLSearchParams({ limit: "100" });
      if (filter.type) q.set("type", filter.type);
      if (filter.since) q.set("since", String(Math.floor(filter.since / 1000)));
      if (filter.until) q.set("until", String(Math.floor(filter.until / 1000)));
      return (await call<List<WireEvent>>("GET", `/v1/events?${q}`, { mode })).data.map(mapEvent);
    },
    async getEvent(id) {
      const ev = await call<WireEvent>("GET", `/v1/events/${id}`);
      const { deliveries, ...signed } = ev;
      const body = JSON.stringify(signed);
      return { event: mapEvent(ev), deliveries: (deliveries ?? []).map((d) => mapDelivery(d, body)) };
    },

    // ── products (FR-DSH-030..033) ──
    async listProducts(mode, filter) {
      currentMode = mode;
      const rows = (await call<List<WireProduct>>("GET", "/v1/products?limit=100", { mode })).data.map(mapProduct);
      return filter.includeArchived ? rows : rows.filter((p) => p.status === "active");
    },
    async createProduct(mode, input, opts) {
      return mapProduct(await call<WireProduct>("POST", "/v1/products", { mode, body: { name: input.name, rate_usd_per_second: input.rateUsdPerSecond, ...(input.description ? { description: input.description } : {}), allow_pause: input.allowPause }, idempotencyKey: idem(opts) }));
    },
    async updateProduct(id, input, opts) {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.description !== undefined) body.description = input.description;
      if (input.allowPause !== undefined) body.allow_pause = input.allowPause;
      if (input.status !== undefined) body.active = input.status === "active";
      return mapProduct(await call<WireProduct>("POST", `/v1/products/${id}`, { body, idempotencyKey: idem(opts) }));
    },
    async createCheckoutLink(productId, opts) {
      // A link minted from the dashboard brings the subscriber back to the dashboard's own pages.
      const origin = o.dashboardOrigin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
      const s = await call<{ id: string; url: string }>("POST", "/v1/checkout/sessions", {
        body: { product: productId, success_url: `${origin}/dashboard/subscriptions`, cancel_url: `${origin}/dashboard/products` },
        idempotencyKey: idem(opts),
      });
      return { id: s.id as `cs_${string}`, url: s.url };
    },
    // ── subscriptions (FR-DSH-040..044) ──
    async listSubscriptions(mode, filter) {
      currentMode = mode;
      const q = new URLSearchParams({ limit: "100" });
      if (filter.status) q.set("status", filter.status);
      if (filter.product) q.set("product", filter.product);
      if (filter.customer) q.set("customer", filter.customer);
      return (await call<List<WireSubscription>>("GET", `/v1/subscriptions?${q}`, { mode })).data.map(mapSubscription);
    },
    async getSubscription(id) {
      const w = await call<WireSubscription>("GET", `/v1/subscriptions/${id}`);
      const [events, invoices] = await Promise.all([
        call<List<WireEvent>>("GET", "/v1/events?limit=100"),
        call<List<WireInvoice>>("GET", `/v1/invoices?subscription=${id}&limit=100`),
      ]);
      const mine = events.data.filter((e) => e.object_id === w.id || e.object_id === w.checkout_session || (e.data.object as { subscription?: string }).subscription === w.id);
      return { subscription: mapSubscription(w), timeline: mine.map(mapEvent), invoices: invoices.data.map((i) => mapInvoice(i, w.customer_email)) };
    },
    async cancelSubscription(id, opts) {
      await call("POST", `/v1/subscriptions/${id}/cancel`, { idempotencyKey: idem(opts) });
      // The chain confirms within seconds; the subscription flips to canceled via ingest (BR-API-005).
      const deadline = Date.now() + 90_000;
      let w = await call<WireSubscription>("GET", `/v1/subscriptions/${id}`);
      while (w.status !== "canceled" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        w = await call<WireSubscription>("GET", `/v1/subscriptions/${id}`);
      }
      if (w.status !== "canceled") throw new DashboardApiError("network", "The cancel was submitted but the network is slow to confirm. The meter will show as stopped shortly.", 0);
      return { subscription: mapSubscription(w), receipt: receiptOf(w) };
    },
    // ── customers (FR-DSH-050/051) ──
    async listCustomers(mode, filter) {
      currentMode = mode;
      const q = new URLSearchParams({ limit: "100" });
      if (filter.search) q.set("search", filter.search);
      return (await call<List<WireCustomer>>("GET", `/v1/customers?${q}`, { mode })).data.map(mapCustomer);
    },
    async getCustomer(id) {
      const [w, subs, events] = await Promise.all([
        call<WireCustomer>("GET", `/v1/customers/${id}`),
        call<List<WireSubscription>>("GET", `/v1/subscriptions?customer=${id}&limit=100`),
        call<List<WireEvent>>("GET", "/v1/events?limit=100"),
      ]);
      const subIds = new Set(subs.data.map((s) => s.id));
      const mine = events.data.filter((e) => (e.object_id && subIds.has(e.object_id)) || subIds.has(String((e.data.object as { subscription?: string }).subscription ?? "")));
      return { customer: mapCustomer(w), subscriptions: subs.data.map(mapSubscription), events: mine.map(mapEvent) };
    },
    async listInvoices(mode, filter) {
      currentMode = mode;
      const q = new URLSearchParams({ limit: "100" });
      if (filter.subscription) q.set("subscription", filter.subscription);
      const rows = (await call<List<WireInvoice>>("GET", `/v1/invoices?${q}`, { mode })).data.filter((i) => i.status === "paid");
      const since = filter.since ? Math.floor(filter.since / 1000) : null;
      const until = filter.until ? Math.floor(filter.until / 1000) : null;
      return rows.filter((i) => (since === null || i.period_end >= since) && (until === null || i.period_end <= until)).map((i) => mapInvoice(i));
    },
    // ── balance & payouts (FR-DSH-120..124) ──
    async listLedger(mode, filter) {
      currentMode = mode;
      const q = new URLSearchParams({ limit: "500" });
      if (filter.kind) q.set("kind", filter.kind);
      if (filter.subscription) q.set("subscription", filter.subscription);
      if (filter.since) q.set("from", String(Math.floor(filter.since / 1000)));
      if (filter.until) q.set("to", String(Math.floor(filter.until / 1000)));
      return (await call<{ data: WireLedger[] }>("GET", `/v1/dashboard/ledger?${q}`, { mode })).data.map(mapLedger);
    },
    async getBalance(mode) {
      currentMode = mode;
      try {
        const b = await call<{ payout_address: string; balance_usd: string; settled_this_month_net_usd: string; as_of: number }>("GET", "/v1/dashboard/balance", { mode });
        return { payoutAddress: b.payout_address, ausdUsd: b.balance_usd, settledThisMonthNetUsd: b.settled_this_month_net_usd, asOf: b.as_of * 1000 } satisfies Balance;
      } catch (e) {
        if (e instanceof DashboardApiError && e.apiCode === "no_payout_address") return { payoutAddress: null, ausdUsd: "0", settledThisMonthNetUsd: "0", asOf: Date.now() };
        throw e;
      }
    },
    async updateMerchant(input, opts) {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.supportEmail !== undefined) body.support_email = input.supportEmail;
      if (input.supportUrl !== undefined) body.support_url = input.supportUrl;
      if (input.branding) body.branding = { display_name: input.branding.name ?? null, accent: input.branding.accent ?? null, support_url: input.branding.supportUrl ?? null };
      return mapMerchant(await call<WireProfile>("POST", "/v1/dashboard/me", { body, idempotencyKey: idem(opts) }));
    },
    async changePayoutAddress(input, opts) {
      await call("POST", "/v1/dashboard/payout_address", { body: { address: input.address, confirm: input.confirm }, idempotencyKey: idem(opts) });
      return mapMerchant(await call<WireProfile>("GET", "/v1/dashboard/me"));
    },
    async getNotificationSettings() {
      const p = await call<WireProfile>("GET", "/v1/dashboard/me");
      return { emailOnExhausted: p.notifications.endpoint_exhausted_email, emailOnExpiring: p.notifications.key_expiry_email };
    },
    async updateNotificationSettings(input, opts) {
      const p = await call<WireProfile>("POST", "/v1/dashboard/me", {
        body: { notifications: { ...(input.emailOnExhausted !== undefined ? { endpoint_exhausted_email: input.emailOnExhausted } : {}), ...(input.emailOnExpiring !== undefined ? { key_expiry_email: input.emailOnExpiring } : {}) } },
        idempotencyKey: idem(opts),
      });
      return { emailOnExhausted: p.notifications.endpoint_exhausted_email, emailOnExpiring: p.notifications.key_expiry_email };
    },
    // ── notifications (FR-DSH-130..132) ──
    async listNotifications(mode) {
      currentMode = mode;
      return (await call<{ data: WireNotification[] }>("GET", "/v1/dashboard/notifications", { mode })).data.map(mapNotification);
    },
    async unreadCounts() {
      const r = await call<{ unread: number; other_mode_unread: number }>("GET", "/v1/dashboard/notifications");
      const mode = modeOf();
      return mode === "test" ? { test: r.unread, live: r.other_mode_unread } : { live: r.unread, test: r.other_mode_unread };
    },
    async markNotificationsRead(mode) {
      await call("POST", "/v1/dashboard/notifications/read_all", { mode });
    },
    // ── activity (FR-DSH-140) ──
    async listActivity(filter) {
      const q = new URLSearchParams({ limit: "200" });
      if (filter.action && AUDIT_TO_API[filter.action]) q.set("action", AUDIT_TO_API[filter.action]!);
      if (filter.since) q.set("since", String(Math.floor(filter.since / 1000)));
      if (filter.until) q.set("until", String(Math.floor(filter.until / 1000)));
      return (await call<{ data: WireAudit[] }>("GET", `/v1/dashboard/activity?${q}`)).data.map(mapAudit).filter((a): a is AuditEntry => a !== null);
    },
    async deleteTestData(input, opts) {
      await call("POST", "/v1/dashboard/test_data/delete", { body: { confirm_name: input.confirmName }, idempotencyKey: idem(opts) });
    },
    // ── search (FR-DSH-005): an id prefix routes to its page; an email to the customer ──
    async resolveSearch(mode, query) {
      currentMode = mode;
      const q = query.trim();
      const routes: Array<[string, string]> = [["prod_", "/dashboard/products"], ["sub_", "/dashboard/subscriptions/"], ["cus_", "/dashboard/customers/"], ["evt_", "/dashboard/developers/events/"], ["wh_", "/dashboard/developers/webhooks/"], ["cs_", "/dashboard/subscriptions"]];
      for (const [prefix, path] of routes) {
        if (q.startsWith(prefix)) {
          const exists = await call<unknown>("GET", prefix === "prod_" ? `/v1/products/${q}` : prefix === "sub_" ? `/v1/subscriptions/${q}` : prefix === "cus_" ? `/v1/customers/${q}` : prefix === "evt_" ? `/v1/events/${q}` : prefix === "wh_" ? `/v1/webhook_endpoints/${q}` : `/v1/checkout/sessions/${q}`).then(() => true).catch(() => false);
          if (!exists) return null;
          return path.endsWith("/") ? `${path}${q}` : path;
        }
      }
      if (q.includes("@")) {
        const c = (await call<List<WireCustomer>>("GET", `/v1/customers?search=${encodeURIComponent(q)}&limit=1`)).data[0];
        return c ? `/dashboard/customers/${c.id}` : null;
      }
      return null;
    },
  };
}
