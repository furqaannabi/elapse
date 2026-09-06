/**
 * The real `DashboardApi` (dashboard FRD FR-DSH-110; API FRD FR-API-100..103, FR-API-003,
 * FR-API-060..064). Cookie-authenticated: every call carries `credentials: "include"`, the
 * mode header, and an `Idempotency-Key` on writes (FR-DSH-112). Snake_case wire objects
 * become the dashboard's types here and nowhere else.
 *
 * Slice 1 (2026-09-06): auth, profile, keys, webhooks, deliveries, events. Methods whose
 * API routes do not exist yet throw `NotWired`, so their pages show the error state
 * (FR-DSH-006) rather than a placeholder.
 */
import { DashboardApiError as MockError, type DashboardApi, type WriteOpts } from "./mock-api";
import { newIdempotencyKey } from "./idempotency";
import type {
  ApiKey, Attempt, ChecklistState, Delivery, DeliveryStatus, Event, EventType, KeyList, KeyStatus, Merchant, Mode, WebhookEndpoint,
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
export class NotWired extends DashboardApiError {
  constructor(what: string) {
    super("invalid_state", `${what} is not connected to the API yet.`, 501, "not_wired");
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
type WireDelivery = { id: string; event: string; endpoint: string; status: "queued" | "retrying" | "succeeded" | "exhausted" | "skipped"; attempt: number; next_attempt_at: number | null; livemode: boolean; created: number; resend_requested: boolean; max_attempts: number; event_type: string; event_created: number; endpoint_url: string; last_attempt?: WireAttempt | null; attempts?: WireAttempt[] };
type WireEvent = { id: string; type: EventType; created: number; livemode: boolean; data: { object: Record<string, unknown> }; pending_webhooks: number; object_id: string | null; delivery_state: "pending" | "delivered" | "failed"; deliveries?: WireDelivery[] };
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

// ─── client ───────────────────────────────────────────────────────────────────

export interface RealDashboardOptions {
  baseUrl: string;
  /** Test hook: the mode is otherwise read per call. */
  getMode?: () => Mode;
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

  const notWired = (what: string) => async (): Promise<never> => {
    throw new NotWired(what);
  };

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
    overview: notWired("Overview"),

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

    // ── later slices ──
    listProducts: notWired("Products"),
    createProduct: notWired("Products"),
    updateProduct: notWired("Products"),
    createCheckoutLink: notWired("Checkout links"),
    listSubscriptions: notWired("Subscriptions"),
    getSubscription: notWired("Subscriptions"),
    cancelSubscription: notWired("Subscriptions"),
    listCustomers: notWired("Customers"),
    getCustomer: notWired("Customers"),
    listInvoices: notWired("Invoices"),
    listLedger: notWired("Balance & payouts"),
    getBalance: notWired("Balance & payouts"),
    async updateMerchant(input, opts) {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.supportEmail !== undefined) body.support_email = input.supportEmail;
      if (input.supportUrl !== undefined) body.support_url = input.supportUrl;
      if (input.branding) body.branding = { display_name: input.branding.name ?? null, accent: input.branding.accent ?? null, support_url: input.branding.supportUrl ?? null };
      return mapMerchant(await call<WireProfile>("POST", "/v1/dashboard/me", { body, idempotencyKey: idem(opts) }));
    },
    changePayoutAddress: notWired("Payout address"),
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
    listNotifications: notWired("Notifications"),
    async unreadCounts() {
      return { test: 0, live: 0 };
    },
    async markNotificationsRead() {},
    listActivity: notWired("Activity"),
    deleteTestData: notWired("Delete test data"),
    async resolveSearch() {
      return null;
    },
  };
}
