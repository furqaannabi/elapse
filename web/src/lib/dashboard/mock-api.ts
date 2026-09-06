/**
 * In-memory dashboard API. Stands in for `api/` until it exists; the
 * dashboard talks to it through the `DashboardApi` interface it will use
 * for the real `/v1/dashboard/*` route group, so swapping is one line in
 * `client.ts`.
 *
 * Auth mirrors the magic-link flow: `requestMagicLink` returns the token it
 * would have emailed (`devToken`), `verifyMagicLink` opens a session that is
 * remembered in localStorage as a stand-in for the HttpOnly cookie. Tokens
 * are single-use and expire after 15 minutes (FR-DSH-011).
 *
 * Seeds (FR-DSH-110): `demo@elapse.finance` is "Nimbus", fully set up;
 * any other email is a brand-new merchant that needs first-run capture.
 *
 * State: the demo merchant is re-seeded on every load (so its meters stay
 * young for demos and reset on refresh); merchants created through the
 * magic link, with everything they create, are persisted in localStorage
 * so a refresh keeps them signed in with their data. Real API replaces
 * all of this.
 *
 * Nothing here knows a secret key. Never log tokens.
 */
import { accruedNano, formatUsd, parseRate, settledNano, elapsedMs as elapsedMsOf } from "@/lib/meter/math";
import type { Mode } from "./mode";
import { buildLedger, deliverEvent, emptyData, makeAttempt, money, randomKeyBody, seedMerchantData, successRate, type MerchantData } from "./seed";
import {
  EVENT_TYPES,
  type ApiKey,
  type AuditAction,
  type AuditEntry,
  type Balance,
  type ChecklistState,
  type Customer,
  type Delivery,
  type Event,
  type EventType,
  type Invoice,
  type KeyList,
  type LedgerEntry,
  type LedgerKind,
  type Merchant,
  type Notification,
  type NotificationSettings,
  type Overview,
  type Product,
  type Subscription,
  type WebhookEndpoint,
} from "./types";

export class DashboardApiError extends Error {
  constructor(
    public code:
      | "unauthenticated"
      | "link_expired"
      | "link_used"
      | "link_invalid"
      | "invalid_input"
      | "invalid_state"
      | "not_found"
      | "network",
    message: string,
  ) {
    super(message);
  }
}

export interface DashboardApi extends DashboardApiMore {
  /**
   * Emails a sign-in link. The real API returns only `{sent}`; the mock also
   * returns the token it would have emailed so dev and tests can follow it.
   */
  requestMagicLink(email: string): Promise<{ sent: true; devToken?: string }>;
  /** Consumes a link token and opens a session. */
  verifyMagicLink(token: string): Promise<Merchant>;
  /** The signed-in merchant, or `unauthenticated`. */
  me(): Promise<Merchant>;
  completeFirstRun(input: { name: string; payoutAddress?: string }): Promise<Merchant>;
  signOut(): Promise<void>;

  /** Home checklist truth for the mode (FR-DSH-020). */
  checklist(mode: Mode): Promise<ChecklistState>;
  /** Home overview: tiles, running meters, recent events (FR-DSH-021–023). */
  overview(mode: Mode): Promise<Overview>;

  /** Publishable key plus every secret key row for the mode (FR-DSH-070). */
  listKeys(mode: Mode): Promise<KeyList>;
  /** Creates a secret key; `secret` is returned here and never again (FR-DSH-071). */
  createKey(mode: Mode, name: string, opts?: WriteOpts): Promise<{ key: ApiKey; secret: string }>;
  /** New key with the same name; the old one expires after `graceMs` (FR-DSH-072). */
  rollKey(id: string, opts: { graceMs: number } & WriteOpts): Promise<{ key: ApiKey; secret: string }>;
  /** Immediate; the row stays for the audit trail (FR-DSH-073). */
  revokeKey(id: string, opts?: WriteOpts): Promise<ApiKey>;

  listEndpoints(mode: Mode): Promise<WebhookEndpoint[]>;
  /** `secret` (whsec_) is returned here and never again (FR-DSH-081). */
  createEndpoint(mode: Mode, input: EndpointInput, opts?: WriteOpts): Promise<{ endpoint: WebhookEndpoint; secret: string }>;
  updateEndpoint(id: string, input: Partial<EndpointInput> & { disabled?: boolean }, opts?: WriteOpts): Promise<WebhookEndpoint>;
  rollEndpointSecret(id: string, opts: { graceMs: number } & WriteOpts): Promise<{ endpoint: WebhookEndpoint; secret: string }>;
  /** Enqueues a synthetic event of `type`; the worker delivers it normally (FR-DSH-082). */
  sendTestEvent(id: string, type: EventType, opts?: WriteOpts): Promise<{ event: Event; delivery: Delivery }>;
  /** Deliveries for one endpoint, newest first (FR-DSH-083). */
  listDeliveries(endpointId: string, filter?: { status?: Delivery["status"] }): Promise<Delivery[]>;
  getDelivery(id: string): Promise<Delivery>;
  /** A fresh manual attempt; the automatic schedule is untouched (FR-DSH-084). */
  resendDelivery(id: string, opts?: WriteOpts): Promise<Delivery>;

  listEvents(mode: Mode, filter: { type?: EventType; since?: number; until?: number }): Promise<Event[]>;
  getEvent(id: string): Promise<{ event: Event; deliveries: Delivery[] }>;

  /** Active products by default; `includeArchived` for the full list (FR-DSH-030). */
  listProducts(mode: Mode, filter: { includeArchived?: boolean }): Promise<Product[]>;
  createProduct(mode: Mode, input: ProductInput, opts?: WriteOpts): Promise<Product>;
  updateProduct(id: string, input: Partial<ProductInput> & { status?: Product["status"] }, opts?: WriteOpts): Promise<Product>;
  /** A test/live checkout session for the product; `url` is what the merchant copies (FR-DSH-032). */
  createCheckoutLink(productId: string, opts?: WriteOpts): Promise<{ id: `cs_${string}`; url: string }>;

  /** Newest first (FR-DSH-040). */
  listSubscriptions(mode: Mode, filter: { status?: Subscription["status"]; product?: string; customer?: string }): Promise<Subscription[]>;
  /** The meter, its lifecycle events oldest first, and its settlements newest first (FR-DSH-041/042). */
  getSubscription(id: string): Promise<{ subscription: Subscription; timeline: Event[]; invoices: Invoice[] }>;
  /** Merchant cancel: same contract path as the subscriber's (FR-DSH-043, BR-DSH-008). */
  cancelSubscription(id: string, opts?: WriteOpts): Promise<{ subscription: Subscription; receipt: CancelReceipt }>;
}

export type CancelReceipt = { secondsElapsed: number; amountSettledUsd: string; refundedUsd: string; canceledAt: number };

export interface DashboardApiMore {
  listCustomers(mode: Mode, filter: { search?: string }): Promise<Customer[]>;
  getCustomer(id: string): Promise<{ customer: Customer; subscriptions: Subscription[]; events: Event[] }>;
  listInvoices(mode: Mode, filter: { subscription?: string; since?: number; until?: number }): Promise<Invoice[]>;
  /** Append-only money movements, newest first (FR-DSH-122). */
  listLedger(mode: Mode, filter: { kind?: LedgerKind; subscription?: string; since?: number; until?: number }): Promise<LedgerEntry[]>;
  getBalance(mode: Mode): Promise<Balance>;
  updateMerchant(input: Partial<Pick<Merchant, "name" | "supportEmail" | "supportUrl" | "branding">>, opts?: WriteOpts): Promise<Merchant>;
  /** Requires the address typed twice; writes the audit log (FR-DSH-101). */
  changePayoutAddress(input: { address: string; confirm: string }, opts?: WriteOpts): Promise<Merchant>;
  getNotificationSettings(): Promise<NotificationSettings>;
  updateNotificationSettings(input: Partial<NotificationSettings>, opts?: WriteOpts): Promise<NotificationSettings>;
  listNotifications(mode: Mode): Promise<Notification[]>;
  unreadCounts(): Promise<Record<Mode, number>>;
  markNotificationsRead(mode: Mode): Promise<void>;
  listActivity(filter: { action?: AuditAction; since?: number; until?: number }): Promise<AuditEntry[]>;
  deleteTestData(input: { confirmName: string }, opts?: WriteOpts): Promise<void>;
  /** Top-bar search: an id or email → the page that shows it, or null (FR-DSH-005). */
  resolveSearch(mode: Mode, query: string): Promise<string | null>;
}

export type ProductInput = { name: string; rateUsdPerSecond: string; description: string | null; allowPause: boolean };

/** Positive decimal string with at most 9 fraction digits; never a float (BR-DSH-007). */
export const RATE_PATTERN = /^(0|[1-9]\d*)(\.\d{1,9})?$/;

function validateProduct(input: Partial<ProductInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new DashboardApiError("invalid_input", "Give the product a name");
  if (input.rateUsdPerSecond !== undefined) {
    const r = input.rateUsdPerSecond.trim();
    if (!RATE_PATTERN.test(r)) throw new DashboardApiError("invalid_input", "Rate must be a decimal like 0.004, with up to 9 decimal places");
    if (parseRate(r) <= 0n) throw new DashboardApiError("invalid_input", "Rate must be more than zero");
  }
}

export type EndpointInput = { url: string; events: EventType[] | "*" };

/** Every mutating call carries an idempotency key (FR-DSH-112). */
export type WriteOpts = { idempotencyKey?: string };

/** The mock always returns the token it would have emailed. */
export type MockDashboardApi = Omit<DashboardApi, "requestMagicLink"> & {
  requestMagicLink(email: string): Promise<{ sent: true; devToken: string }>;
};

export const MAGIC_LINK_TTL_MS = 15 * 60_000;
const SESSION_KEY = "elapse-mock-session";
const PERSIST_KEY = "elapse-mock-store";
const PERSIST_VERSION = 1;

type Persisted = {
  version: number;
  merchants: Merchant[];
  data: [string, Record<Mode, MerchantData>][];
  audit: [string, AuditEntry[]][];
  notificationSettings: [string, NotificationSettings][];
};

type Token = { email: string; issuedAt: number; usedAt: number | null };

type Store = {
  merchants: Map<string, Merchant>;
  tokens: Map<string, Token>;
  /** merchantId → mode → data */
  data: Map<string, Record<Mode, MerchantData>>;
  /** idempotency key → stored response */
  idempotent: Map<string, unknown>;
  audit: Map<string, AuditEntry[]>;
  notificationSettings: Map<string, NotificationSettings>;
};

let nextId = 1;
const newId = (prefix: string) => `${prefix}_${(nextId++).toString(36).padStart(6, "0")}`;

function seed(now: number): Store {
  const merchants = new Map<string, Merchant>();
  const demo: Merchant = {
    id: "mrc_demo",
    email: "demo@elapse.finance",
    name: "Nimbus",
    supportEmail: "help@nimbus.example",
    supportUrl: "https://nimbus.example/support",
    payoutAddress: "0x7a3f9c2e1d4b5a6f8e9d0c1b2a3f4e5d6c7b8a90",
    feeBps: 100,
    branding: { name: "Nimbus", accent: undefined, supportUrl: "https://nimbus.example/support" },
    createdAt: now - 21 * 86_400_000,
  };
  merchants.set(demo.id, demo);
  const data = new Map<string, Record<Mode, MerchantData>>();
  data.set(demo.id, {
    test: seedMerchantData({ now, livemode: false, feeBps: demo.feeBps }),
    live: seedMerchantData({ now, livemode: true, feeBps: demo.feeBps, scale: 0.3 }),
  });
  const audit = new Map<string, AuditEntry[]>();
  audit.set(demo.id, [
    { id: "aud_0001", at: now - 20 * 86_400_000, actor: demo.email, action: "signin", target: demo.id, ip: "203.0.113.4" },
    { id: "aud_0002", at: now - 19 * 86_400_000, actor: demo.email, action: "key.created", target: "key_t0001", ip: "203.0.113.4" },
    { id: "aud_0003", at: now - 18 * 86_400_000, actor: demo.email, action: "endpoint.added", target: "wh_t0001", ip: "203.0.113.4" },
    { id: "aud_0004", at: now - 14 * 86_400_000, actor: demo.email, action: "key.revoked", target: "key_t0003", ip: "198.51.100.7" },
    { id: "aud_0005", at: now - 3 * 86_400_000, actor: demo.email, action: "delivery.resent", target: "dlv_t0042", ip: "203.0.113.4" },
    { id: "aud_0006", at: now - 40 * 60_000, actor: demo.email, action: "signin", target: demo.id, ip: "203.0.113.4" },
  ]);
  return { merchants, tokens: new Map(), data, idempotent: new Map(), audit, notificationSettings: new Map() };
}

function validateEndpoint(input: Partial<EndpointInput>) {
  if (input.url !== undefined) {
    let u: URL;
    try {
      u = new URL(input.url);
    } catch {
      throw new DashboardApiError("invalid_input", "Enter a full URL, starting with https://");
    }
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
      throw new DashboardApiError("invalid_input", "Endpoints must use https (http is allowed for localhost)");
    }
  }
  if (input.events !== undefined && input.events !== "*") {
    if (input.events.length === 0) throw new DashboardApiError("invalid_input", "Choose at least one event type");
    for (const t of input.events) {
      if (!EVENT_TYPES.includes(t)) throw new DashboardApiError("invalid_input", `Unknown event type: ${t}`);
    }
  }
}

function keyStatus(k: Omit<ApiKey, "status">, now: number): ApiKey["status"] {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt !== null) return k.expiresAt <= now ? "expired" : "expiring";
  return "active";
}

function withStatus(k: Omit<ApiKey, "status">, now: number): ApiKey {
  return { ...k, status: keyStatus(k, now) };
}

const DAY = 86_400_000;

/** Decimal USD string (possibly grouped, "1,234.50") → nano-dollars. */
const usd = (v: string) => parseRate(v.replace(/,/g, ""));

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(merchantId: string | null) {
  try {
    if (merchantId) localStorage.setItem(SESSION_KEY, merchantId);
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Everything except the demo merchant, which is re-seeded. */
function persist(store: Store) {
  try {
    const out: Persisted = {
      version: PERSIST_VERSION,
      merchants: [...store.merchants.values()].filter((m) => m.id !== "mrc_demo"),
      data: [...store.data.entries()].filter(([id]) => id !== "mrc_demo"),
      audit: [...store.audit.entries()].filter(([id]) => id !== "mrc_demo"),
      notificationSettings: [...store.notificationSettings.entries()],
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(out));
  } catch {}
}

function restore(store: Store) {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Persisted;
    if (p.version !== PERSIST_VERSION) return;
    for (const m of p.merchants) store.merchants.set(m.id, m);
    for (const [id, d] of p.data) store.data.set(id, d);
    for (const [id, a] of p.audit) store.audit.set(id, a);
    for (const [id, n] of p.notificationSettings) store.notificationSettings.set(id, n);
  } catch {}
}

/** Module-level so a re-created api (client-side navigation) sees the same merchants. */
let shared: Store | null = null;

export function createMockDashboardApi(opts: { now?: () => number; latencyMs?: number } = {}): MockDashboardApi {
  const now = opts.now ?? Date.now;
  const latency = opts.latencyMs ?? 250;
  if (!shared) {
    shared = seed(now());
    restore(shared);
  }
  const store = shared;
  let dirty = false;

  /** Mutations mark the store dirty; the next `wait` writes it through. */
  const touch = () => {
    dirty = true;
  };

  const wait = <T,>(v: T): Promise<T> => {
    if (dirty) {
      dirty = false;
      persist(store);
    }
    return latency ? new Promise((r) => setTimeout(() => r(v), latency)) : Promise.resolve(v);
  };

  const fail = (code: DashboardApiError["code"], message: string): never => {
    throw new DashboardApiError(code, message);
  };

  const current = (): Merchant => {
    const id = readSession();
    const m = id ? store.merchants.get(id) : undefined;
    return m ?? fail("unauthenticated", "Sign in to continue");
  };

  const log = (action: AuditAction, target: string) => {
    const m = current();
    const list = store.audit.get(m.id) ?? [];
    list.unshift({ id: newId("aud") as AuditEntry["id"], at: now(), actor: m.email, action, target, ip: "203.0.113.4" });
    store.audit.set(m.id, list);
  };

  /** Replays a stored response for a repeated idempotency key. */
  const idempotent = async <T,>(key: string | undefined, run: () => Promise<T>): Promise<T> => {
    touch();
    if (!key) return run();
    const scoped = `${readSession()}:${key}`;
    if (store.idempotent.has(scoped)) return store.idempotent.get(scoped) as T;
    const result = await run();
    store.idempotent.set(scoped, result);
    return result;
  };

  const findKey = (id: string): { data: MerchantData; key: Omit<ApiKey, "status"> } => {
    const m = current();
    for (const mode of ["test", "live"] as const) {
      const data = dataFor(m.id, mode);
      const key = data.keys.find((k) => k.id === id);
      if (key) return { data, key };
    }
    return fail("not_found", "No such key");
  };

  const byEmail = (email: string) =>
    [...store.merchants.values()].find((m) => m.email === email.toLowerCase());

  const findProduct = (id: string): { data: MerchantData; product: Product } => {
    const m = current();
    for (const mode of ["test", "live"] as const) {
      const data = dataFor(m.id, mode);
      const product = data.products.find((p) => p.id === id);
      if (product) return { data, product };
    }
    return fail("not_found", "No such product");
  };

  const findSubscription = (id: string): { data: MerchantData; subscription: Subscription } => {
    const m = current();
    for (const mode of ["test", "live"] as const) {
      const data = dataFor(m.id, mode);
      const subscription = data.subscriptions.find((x) => x.id === id);
      if (subscription) return { data, subscription };
    }
    return fail("not_found", "No such subscription");
  };

  /** Fan an event out to every subscribed endpoint, as the worker would. */
  const emit = (data: MerchantData, event: Event) => {
    data.events.unshift(event);
    for (const ep of data.endpoints) {
      if (ep.events !== "*" && !ep.events.includes(event.type)) continue;
      data.deliveries.unshift(deliverEvent(event, ep, now(), newId, "succeed"));
    }
    rollUp(data, event.id);
  };

  const findEndpoint = (id: string): { data: MerchantData; endpoint: WebhookEndpoint } => {
    const m = current();
    for (const mode of ["test", "live"] as const) {
      const data = dataFor(m.id, mode);
      const endpoint = data.endpoints.find((e) => e.id === id);
      if (endpoint) return { data, endpoint };
    }
    return fail("not_found", "No such endpoint");
  };

  const findDelivery = (id: string): { data: MerchantData; delivery: Delivery } => {
    const m = current();
    for (const mode of ["test", "live"] as const) {
      const data = dataFor(m.id, mode);
      const delivery = data.deliveries.find((d) => d.id === id);
      if (delivery) return { data, delivery };
    }
    return fail("not_found", "No such delivery");
  };

  const refreshRates = (data: MerchantData) => {
    for (const ep of data.endpoints) ep.successRate7d = successRate(data.deliveries, ep.id, now());
  };

  const rollUp = (data: MerchantData, eventId: string) => {
    const e = data.events.find((x) => x.id === eventId);
    if (!e) return;
    const mine = data.deliveries.filter((d) => d.event.id === e.id && d.status !== "skipped");
    e.pendingWebhooks = mine.filter((d) => d.status === "pending" || d.status === "failed").length;
    e.deliveryState = mine.some((d) => d.status === "exhausted") ? "failed" : e.pendingWebhooks > 0 ? "pending" : "delivered";
  };

  const dataFor = (merchantId: string, mode: Mode): MerchantData => {
    let rec = store.data.get(merchantId);
    if (!rec) {
      rec = { test: emptyData(false), live: emptyData(true) };
      store.data.set(merchantId, rec);
    }
    return rec[mode];
  };

  return {
    async requestMagicLink(email) {
      const clean = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) fail("invalid_input", "Enter a valid email address");
      const token = newId("tok");
      store.tokens.set(token, { email: clean, issuedAt: now(), usedAt: null });
      return wait({ sent: true as const, devToken: token });
    },

    async verifyMagicLink(token) {
      const t = store.tokens.get(token);
      if (!t) throw new DashboardApiError("link_invalid", "This link is not valid");
      if (t.usedAt) throw new DashboardApiError("link_used", "This link has already been used");
      if (now() - t.issuedAt > MAGIC_LINK_TTL_MS) throw new DashboardApiError("link_expired", "This link has expired");
      t.usedAt = now();
      let merchant = byEmail(t.email);
      if (!merchant) {
        merchant = {
          id: newId("mrc") as Merchant["id"],
          email: t.email,
          name: null,
          supportEmail: null,
          supportUrl: null,
          payoutAddress: null,
          feeBps: 100,
          branding: { name: "" },
          createdAt: now(),
        };
        store.merchants.set(merchant.id, merchant);
      }
      writeSession(merchant.id);
      touch();
      const list = store.audit.get(merchant.id) ?? [];
      list.unshift({ id: newId("aud") as AuditEntry["id"], at: now(), actor: merchant.email, action: "signin", target: merchant.id, ip: "203.0.113.4" });
      store.audit.set(merchant.id, list);
      return wait(merchant);
    },

    async me() {
      return wait(current());
    },

    async completeFirstRun({ name, payoutAddress }) {
      const m = current();
      const clean = name.trim();
      if (!clean) fail("invalid_input", "Business name is required");
      const next: Merchant = {
        ...m,
        name: clean,
        payoutAddress: payoutAddress?.trim() || null,
        branding: { ...m.branding, name: clean },
      };
      store.merchants.set(m.id, next);
      touch();
      return wait(next);
    },

    async signOut() {
      writeSession(null);
      return wait(undefined);
    },

    async checklist(mode) {
      const d = dataFor(current().id, mode);
      return wait({
        hasProduct: d.products.length > 0,
        hasSecretKey: d.keys.some((k) => !k.revokedAt),
        hasEndpoint: d.endpoints.length > 0,
        hasSucceededDelivery: d.deliveries.some((x) => x.status === "succeeded"),
      });
    },

    async overview(mode) {
      const d = dataFor(current().id, mode);
      const t = now();
      const active = d.subscriptions.filter((s) => s.status === "active" && s.startedAt);
      const dayStart = startOfDay(t);
      let accruedToday = 0n;
      for (const s of active) {
        const from = Math.max(s.startedAt!, dayStart);
        accruedToday += accruedNano(parseRate(s.rateUsdPerSecond), elapsedMsOf({ startedAt: from, now: t, pausedAt: null }));
      }
      for (const inv of d.invoices) {
        if (inv.settledAt >= dayStart) accruedToday += usd(inv.grossUsd);
      }
      let settledWeekNet = 0n;
      for (const inv of d.invoices) {
        if (inv.settledAt >= t - 7 * DAY) settledWeekNet += usd(inv.netUsd);
      }
      const failedPaymentsWeek = d.events.filter(
        (e) => e.type === "invoice.payment_failed" && e.createdAt >= t - 7 * DAY,
      ).length;
      return wait({
        runningNow: active.length,
        accruedTodayUsd: formatUsd(accruedToday, 2, { symbol: false }),
        settledWeekNetUsd: formatUsd(settledWeekNet, 2, { symbol: false }),
        failedPaymentsWeek,
        running: [...active].sort((a, b) => b.startedAt! - a.startedAt!).slice(0, 10),
        recentEvents: d.events.slice(0, 10),
      });
    },

    async listKeys(mode) {
      const d = dataFor(current().id, mode);
      const t = now();
      return wait({
        publishable: d.publishableKey,
        secret: d.keys.map((k) => withStatus(k, t)).sort((a, b) => b.createdAt - a.createdAt),
      });
    },

    async createKey(mode, name, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const d = dataFor(current().id, mode);
        const clean = name.trim();
        if (!clean) fail("invalid_input", "Give the key a name");
        const secret = `sk_${mode}_${randomKeyBody(32)}`;
        const key: Omit<ApiKey, "status"> = {
          id: newId("key") as ApiKey["id"],
          livemode: mode === "live",
          name: clean,
          prefix: secret.slice(0, 12),
          last4: secret.slice(-4),
          createdAt: now(),
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: null,
        };
        d.keys.push(key);
        log("key.created", key.id);
        return wait({ key: withStatus(key, now()), secret });
      });
    },

    async rollKey(id, opts) {
      return idempotent(opts.idempotencyKey, async () => {
        const { data, key: old } = findKey(id);
        if (old.revokedAt) fail("invalid_input", "This key is revoked");
        const t = now();
        old.expiresAt = t + Math.max(0, opts.graceMs);
        const mode = old.livemode ? "live" : "test";
        const secret = `sk_${mode}_${randomKeyBody(32)}`;
        const key: Omit<ApiKey, "status"> = {
          id: newId("key") as ApiKey["id"],
          livemode: old.livemode,
          name: old.name,
          prefix: secret.slice(0, 12),
          last4: secret.slice(-4),
          createdAt: t,
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: null,
        };
        data.keys.push(key);
        log("key.rolled", old.id);
        return wait({ key: withStatus(key, t), secret });
      });
    },

    async revokeKey(id, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { key } = findKey(id);
        if (!key.revokedAt) {
          key.revokedAt = now();
          log("key.revoked", key.id);
        }
        return wait(withStatus(key, now()));
      });
    },

    async listEndpoints(mode) {
      const d = dataFor(current().id, mode);
      refreshRates(d);
      return wait([...d.endpoints].sort((a, b) => b.createdAt - a.createdAt).map((e) => ({ ...e })));
    },

    async createEndpoint(mode, input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const d = dataFor(current().id, mode);
        validateEndpoint(input);
        const endpoint: WebhookEndpoint = {
          id: newId("wh") as WebhookEndpoint["id"],
          livemode: mode === "live",
          url: input.url,
          events: input.events === "*" ? "*" : [...input.events],
          disabled: false,
          successRate7d: 1,
          previousSecretExpiresAt: null,
          createdAt: now(),
        };
        d.endpoints.push(endpoint);
        log("endpoint.added", endpoint.id);
        return wait({ endpoint: { ...endpoint }, secret: `whsec_${randomKeyBody(32)}` });
      });
    },

    async updateEndpoint(id, input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { endpoint } = findEndpoint(id);
        validateEndpoint(input);
        if (input.url !== undefined) endpoint.url = input.url;
        if (input.events !== undefined) endpoint.events = input.events === "*" ? "*" : [...input.events];
        if (input.disabled !== undefined) {
          if (input.disabled !== endpoint.disabled) log(input.disabled ? "endpoint.disabled" : "endpoint.enabled", endpoint.id);
          endpoint.disabled = input.disabled;
        }
        if (input.url !== undefined || input.events !== undefined) log("endpoint.changed", endpoint.id);
        return wait({ ...endpoint });
      });
    },

    async rollEndpointSecret(id, opts) {
      return idempotent(opts.idempotencyKey, async () => {
        const { endpoint } = findEndpoint(id);
        endpoint.previousSecretExpiresAt = now() + Math.max(0, opts.graceMs);
        log("secret.rolled", endpoint.id);
        return wait({ endpoint: { ...endpoint }, secret: `whsec_${randomKeyBody(32)}` });
      });
    },

    async sendTestEvent(id, type, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { data, endpoint } = findEndpoint(id);
        if (!EVENT_TYPES.includes(type)) fail("invalid_input", `Unknown event type: ${type}`);
        const t = now();
        const event: Event = {
          id: newId("evt") as Event["id"],
          livemode: endpoint.livemode,
          type,
          objectId: "sub_test",
          createdAt: t,
          pendingWebhooks: 0,
          deliveryState: "delivered",
          payload: { test: true, subscription: "sub_test", seconds_elapsed: 83, amount_settled: "0.33" },
        };
        data.events.unshift(event);
        const delivery = deliverEvent(event, endpoint, t, newId, "succeed");
        data.deliveries.unshift(delivery);
        rollUp(data, event.id);
        refreshRates(data);
        return wait({ event: { ...event }, delivery: { ...delivery } });
      });
    },

    async listDeliveries(endpointId, filter = {}) {
      const { data } = findEndpoint(endpointId);
      return wait(
        data.deliveries
          .filter((d) => d.endpoint.id === endpointId && (!filter.status || d.status === filter.status))
          .sort((a, b) => b.event.createdAt - a.event.createdAt)
          .map((d) => ({ ...d, attempts: [...d.attempts] })),
      );
    },

    async getDelivery(id) {
      const { delivery } = findDelivery(id);
      return wait({ ...delivery, attempts: [...delivery.attempts] });
    },

    async resendDelivery(id, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { data, delivery } = findDelivery(id);
        const event = data.events.find((e) => e.id === delivery.event.id);
        const endpoint = data.endpoints.find((e) => e.id === delivery.endpoint.id);
        if (!event || !endpoint) throw new DashboardApiError("not_found", "The event for this delivery no longer exists");
        const ok = !endpoint.disabled;
        const attempt = makeAttempt(event, now(), ok ? { code: 200, body: '{"received":true}' } : { code: null, error: "endpoint disabled" }, true);
        delivery.attempts.push(attempt);
        delivery.lastResponseCode = attempt.responseCode;
        if (ok && delivery.status !== "succeeded") {
          delivery.status = "succeeded";
          delivery.nextAttemptAt = null;
        }
        rollUp(data, event.id);
        refreshRates(data);
        log("delivery.resent", delivery.id);
        return wait({ ...delivery, attempts: [...delivery.attempts] });
      });
    },

    async listEvents(mode, filter) {
      const d = dataFor(current().id, mode);
      return wait(
        d.events
          .filter((e) => (!filter.type || e.type === filter.type) && (!filter.since || e.createdAt >= filter.since) && (!filter.until || e.createdAt <= filter.until))
          .map((e) => ({ ...e })),
      );
    },

    async listProducts(mode, filter) {
      const d = dataFor(current().id, mode);
      return wait(
        d.products
          .filter((p) => filter.includeArchived || p.status === "active")
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((p) => ({ ...p })),
      );
    },

    async createProduct(mode, input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const d = dataFor(current().id, mode);
        validateProduct(input);
        const product: Product = {
          id: newId("prod") as Product["id"],
          livemode: mode === "live",
          name: input.name.trim(),
          description: input.description?.trim() || null,
          rateUsdPerSecond: input.rateUsdPerSecond.trim(),
          allowPause: input.allowPause,
          status: "active",
          activeSubscriptions: 0,
          createdAt: now(),
        };
        d.products.push(product);
        return wait({ ...product });
      });
    },

    async updateProduct(id, input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { product } = findProduct(id);
        validateProduct(input);
        if (input.name !== undefined) product.name = input.name.trim();
        if (input.description !== undefined) product.description = input.description?.trim() || null;
        if (input.rateUsdPerSecond !== undefined) product.rateUsdPerSecond = input.rateUsdPerSecond.trim();
        if (input.allowPause !== undefined) product.allowPause = input.allowPause;
        if (input.status !== undefined) product.status = input.status;
        return wait({ ...product });
      });
    },

    async createCheckoutLink(productId, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const { product } = findProduct(productId);
        if (product.status === "archived") throw new DashboardApiError("invalid_state", "Archived products cannot start new meters");
        const id = newId("cs") as `cs_${string}`;
        const base = typeof window !== "undefined" ? window.location.origin : "https://elapse.finance";
        return wait({ id, url: `${base}/c/${id}` });
      });
    },

    async listSubscriptions(mode, filter) {
      const d = dataFor(current().id, mode);
      return wait(
        d.subscriptions
          .filter((x) => (!filter.status || x.status === filter.status) && (!filter.product || x.product.id === filter.product) && (!filter.customer || x.customer.id === filter.customer))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((x) => ({ ...x })),
      );
    },

    async getSubscription(id) {
      const { data, subscription } = findSubscription(id);
      const timeline = data.events
        .filter((e) => e.objectId === subscription.id || e.objectId === subscription.checkoutSession)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((e) => ({ ...e }));
      const invoices = data.invoices.filter((i) => i.subscription === subscription.id).sort((a, b) => b.settledAt - a.settledAt).map((i) => ({ ...i }));
      return wait({ subscription: { ...subscription }, timeline, invoices });
    },

    async cancelSubscription(id, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const m = current();
        const { data, subscription: sub } = findSubscription(id);
        if (sub.status === "canceled") throw new DashboardApiError("invalid_state", "This meter is already stopped");
        if (sub.status === "incomplete" || !sub.startedAt) throw new DashboardApiError("invalid_state", "This meter never started");
        const t = now();
        const rate = parseRate(sub.rateUsdPerSecond);
        const end = sub.pausedAt ?? t;
        const seconds = Math.floor((end - sub.startedAt) / 1000);
        const funded = usd(sub.fundedUsd);
        const total = settledNano(rate, seconds) > funded ? funded : settledNano(rate, seconds);
        const already = usd(sub.settledUsd);
        const pull = total > already ? total - already : 0n;
        if (pull > 0n) {
          const f = (pull * BigInt(m.feeBps)) / 10_000n;
          const inv: Invoice = {
            id: newId("inv") as Invoice["id"],
            livemode: sub.livemode,
            subscription: sub.id,
            customer: sub.customer,
            settledAt: t,
            seconds: seconds - Math.floor(Number((already * 1_000_000_000n) / rate) / 1_000_000_000),
            ...money(pull, f),
            txId: `0x${(0x5a11 + data.invoices.length * 7919).toString(16).padStart(8, "0")}${"".padEnd(56, "c4")}`.slice(0, 66),
          };
          data.invoices.unshift(inv);
          emit(data, {
            id: newId("evt") as Event["id"],
            livemode: sub.livemode,
            type: "invoice.settled",
            objectId: sub.id,
            createdAt: t,
            pendingWebhooks: 0,
            deliveryState: "delivered",
            payload: { subscription: sub.id, seconds: inv.seconds, amount_settled: inv.grossUsd },
          });
        }
        sub.status = "canceled";
        sub.canceledAt = t;
        sub.settledUsd = formatUsd(total, 3, { symbol: false });
        const receipt: CancelReceipt = {
          secondsElapsed: seconds,
          amountSettledUsd: formatUsd(total, 3, { symbol: false }),
          refundedUsd: formatUsd(funded - total, 3, { symbol: false }),
          canceledAt: t,
        };
        emit(data, {
          id: newId("evt") as Event["id"],
          livemode: sub.livemode,
          type: "subscription.canceled",
          objectId: sub.id,
          createdAt: t,
          pendingWebhooks: 0,
          deliveryState: "delivered",
          payload: { subscription: sub.id, seconds_elapsed: seconds, amount_settled: receipt.amountSettledUsd, canceled_by: "merchant" },
        });
        const product = data.products.find((p) => p.id === sub.product.id);
        if (product && product.activeSubscriptions > 0) product.activeSubscriptions--;
        refreshRates(data);
        data.ledger = buildLedger(data.subscriptions, data.invoices, sub.livemode, newId);
        return wait({ subscription: { ...sub }, receipt });
      });
    },

    async listCustomers(mode, filter) {
      const d = dataFor(current().id, mode);
      const q = filter.search?.trim().toLowerCase();
      return wait(
        d.customers
          .filter((c) => !q || (c.email ?? "").toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((c) => ({ ...c })),
      );
    },

    async getCustomer(id) {
      const m = current();
      for (const mode of ["test", "live"] as const) {
        const data = dataFor(m.id, mode);
        const customer = data.customers.find((c) => c.id === id);
        if (customer) {
          const subscriptions = data.subscriptions.filter((s) => s.customer.id === id).sort((a, b) => b.createdAt - a.createdAt);
          const ids = new Set(subscriptions.flatMap((s) => [s.id, s.checkoutSession]));
          const events = data.events.filter((e) => ids.has(e.objectId as `sub_${string}`)).slice(0, 50);
          return wait({ customer: { ...customer }, subscriptions: subscriptions.map((s) => ({ ...s })), events: events.map((e) => ({ ...e })) });
        }
      }
      return fail("not_found", "No such customer");
    },

    async listInvoices(mode, filter) {
      const d = dataFor(current().id, mode);
      return wait(
        d.invoices
          .filter((i) => (!filter.subscription || i.subscription === filter.subscription) && (!filter.since || i.settledAt >= filter.since) && (!filter.until || i.settledAt <= filter.until))
          .sort((a, b) => b.settledAt - a.settledAt)
          .map((i) => ({ ...i })),
      );
    },

    async listLedger(mode, filter) {
      const d = dataFor(current().id, mode);
      return wait(
        d.ledger
          .filter((l) => (!filter.kind || l.kind === filter.kind) && (!filter.subscription || l.subscription === filter.subscription) && (!filter.since || l.blockTime >= filter.since) && (!filter.until || l.blockTime <= filter.until))
          .map((l) => ({ ...l })),
      );
    },

    async getBalance(mode) {
      const m = current();
      const d = dataFor(m.id, mode);
      const t = now();
      const monthStart = new Date(t);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      let month = 0n;
      let all = 0n;
      for (const inv of d.invoices) {
        all += usd(inv.netUsd);
        if (inv.settledAt >= monthStart.getTime()) month += usd(inv.netUsd);
      }
      return wait({
        payoutAddress: m.payoutAddress,
        ausdUsd: formatUsd(m.payoutAddress ? all : 0n, 2, { symbol: false }),
        settledThisMonthNetUsd: formatUsd(month, 2, { symbol: false }),
        asOf: t,
      });
    },

    async updateMerchant(input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const m = current();
        const name = input.name ?? undefined;
        if (name !== undefined && !name.trim()) throw new DashboardApiError("invalid_input", "Business name is required");
        const next: Merchant = {
          ...m,
          name: name !== undefined ? name.trim() : m.name,
          supportEmail: input.supportEmail !== undefined ? input.supportEmail?.trim() || null : m.supportEmail,
          supportUrl: input.supportUrl !== undefined ? input.supportUrl?.trim() || null : m.supportUrl,
          branding: input.branding ? { ...m.branding, ...input.branding } : m.branding,
        };
        store.merchants.set(m.id, next);
        return wait(next);
      });
    },

    async changePayoutAddress({ address, confirm }, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const m = current();
        const a = address.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new DashboardApiError("invalid_input", "Enter a 42-character address starting with 0x");
        if (a !== confirm.trim()) throw new DashboardApiError("invalid_input", "The two addresses don't match");
        const next: Merchant = { ...m, payoutAddress: a };
        store.merchants.set(m.id, next);
        log("payout_address.changed", m.id);
        return wait(next);
      });
    },

    async getNotificationSettings() {
      const m = current();
      return wait(store.notificationSettings.get(m.id) ?? { emailOnExhausted: true, emailOnExpiring: true });
    },

    async updateNotificationSettings(input, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const m = current();
        const cur = store.notificationSettings.get(m.id) ?? { emailOnExhausted: true, emailOnExpiring: true };
        const next = { ...cur, ...input };
        store.notificationSettings.set(m.id, next);
        return wait(next);
      });
    },

    async listNotifications(mode) {
      const d = dataFor(current().id, mode);
      return wait(d.notifications.map((n) => ({ ...n })));
    },

    async unreadCounts() {
      const m = current();
      return wait({
        test: dataFor(m.id, "test").notifications.filter((n) => !n.readAt).length,
        live: dataFor(m.id, "live").notifications.filter((n) => !n.readAt).length,
      });
    },

    async markNotificationsRead(mode) {
      const d = dataFor(current().id, mode);
      const t = now();
      for (const n of d.notifications) if (!n.readAt) n.readAt = t;
      touch();
      return wait(undefined);
    },

    async listActivity(filter) {
      const m = current();
      const list = store.audit.get(m.id) ?? [];
      return wait(
        list
          .filter((a) => (!filter.action || a.action === filter.action) && (!filter.since || a.at >= filter.since) && (!filter.until || a.at <= filter.until))
          .sort((a, b) => b.at - a.at)
          .map((a) => ({ ...a })),
      );
    },

    async deleteTestData({ confirmName }, opts = {}) {
      return idempotent(opts.idempotencyKey, async () => {
        const m = current();
        if (confirmName.trim() !== (m.name ?? "")) throw new DashboardApiError("invalid_input", "Type your business name exactly to confirm");
        const rec = store.data.get(m.id);
        if (rec) rec.test = emptyData(false);
        log("test_data.deleted", m.id);
        return wait(undefined);
      });
    },

    async resolveSearch(mode, query) {
      const d = dataFor(current().id, mode);
      const q = query.trim();
      if (!q) return wait(null);
      const lower = q.toLowerCase();
      if (lower.startsWith("sub_")) return wait(d.subscriptions.some((x) => x.id === q) ? `/dashboard/subscriptions/${q}` : null);
      if (lower.startsWith("cs_")) {
        const s = d.subscriptions.find((x) => x.checkoutSession === q);
        return wait(s ? `/dashboard/subscriptions/${s.id}` : null);
      }
      if (lower.startsWith("cus_")) return wait(d.customers.some((x) => x.id === q) ? `/dashboard/customers/${q}` : null);
      if (lower.startsWith("evt_")) return wait(d.events.some((x) => x.id === q) ? `/dashboard/developers/events/${q}` : null);
      if (lower.startsWith("wh_")) return wait(d.endpoints.some((x) => x.id === q) ? `/dashboard/developers/webhooks/${q}` : null);
      if (lower.startsWith("prod_")) return wait(d.products.some((x) => x.id === q) ? `/dashboard/products?highlight=${q}` : null);
      if (lower.includes("@")) {
        const c = d.customers.find((x) => x.email?.toLowerCase() === lower);
        return wait(c ? `/dashboard/customers/${c.id}` : null);
      }
      return wait(null);
    },

    async getEvent(id) {
      const m = current();
      for (const mode of ["test", "live"] as const) {
        const data = dataFor(m.id, mode);
        const event = data.events.find((e) => e.id === id);
        if (event) {
          const body = { id: event.id, type: event.type, created: Math.floor(event.createdAt / 1000), livemode: event.livemode, data: { object: event.payload } };
          return wait({ event: { ...event, payload: body }, deliveries: data.deliveries.filter((x) => x.event.id === id).map((x) => ({ ...x })) });
        }
      }
      return fail("not_found", "No such event");
    },
  };
}

/** Test-only: forget every seeded and created merchant. */
export function resetMockDashboardApi() {
  shared = null;
}
