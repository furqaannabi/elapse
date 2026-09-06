/**
 * Deterministic demo data for the mock dashboard API (FR-DSH-110).
 *
 * "Nimbus" (demo@elapse.finance) gets a full test-mode dataset and a smaller
 * live one: products, customers, ~30 subscriptions across every status,
 * invoices with gross/fee/net, and the events they produced. A brand-new
 * merchant gets nothing, so the checklist starts at 0 of 4.
 *
 * Every number comes from the meter math (whole seconds × rate, floored),
 * so what the dashboard shows matches what the contract would settle.
 * Values are synthetic and the UI labels them as demo data.
 */
import { formatUsd, parseRate, settledNano, NANO } from "@/lib/meter/math";
import type {
  ApiKey,
  Attempt,
  Customer,
  Delivery,
  LedgerEntry,
  Notification,
  WebhookEndpoint,
  Event,
  EventType,
  Invoice,
  Product,
  Subscription,
  SubscriptionStatus,
} from "./types";

export type MerchantData = {
  products: Product[];
  customers: Customer[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  events: Event[];
  publishableKey: string;
  keys: Omit<ApiKey, "status">[];
  endpoints: WebhookEndpoint[];
  deliveries: Delivery[];
  ledger: LedgerEntry[];
  notifications: Notification[];
};

/** Rebuilds the ledger from subscriptions and invoices: the chain's truth, derived. */
export function buildLedger(subs: Subscription[], invoices: Invoice[], livemode: boolean, idFn: (p: string) => string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const row = (kind: LedgerEntry["kind"], amountUsd: string, sub: Subscription, txId: string, at: number, invoice: LedgerEntry["invoice"] = null): LedgerEntry => ({
    id: idFn("led") as LedgerEntry["id"],
    livemode,
    kind,
    amountUsd,
    subscription: sub.id,
    customer: sub.customer,
    txId,
    blockTime: at,
    reversedBy: null,
    invoice,
  });
  for (const sub of subs) {
    if (!sub.startedAt) continue;
    out.push(row("deposit", sub.fundedUsd, sub, `0x${(0xd3b0 + out.length * 104729).toString(16).padStart(8, "0")}${"".padEnd(56, "1e")}`.slice(0, 66), sub.startedAt - 2000));
    for (const inv of invoices.filter((i) => i.subscription === sub.id)) {
      out.push(row("settlement", inv.grossUsd, sub, inv.txId, inv.settledAt, inv.id));
      out.push(row("fee", inv.feeUsd, sub, inv.txId, inv.settledAt, inv.id));
    }
    if (sub.status === "canceled" && sub.canceledAt) {
      const funded = parseRate(sub.fundedUsd.replace(/,/g, ""));
      const settled = parseRate(sub.settledUsd.replace(/,/g, ""));
      const refund = funded > settled ? funded - settled : 0n;
      if (refund > 0n) {
        const last = invoices.filter((i) => i.subscription === sub.id).sort((a, b) => b.settledAt - a.settledAt)[0];
        out.push(row("refund", formatUsd(refund, 3, { symbol: false }), sub, last?.txId ?? `0x${"".padEnd(64, "9c")}`, sub.canceledAt));
      }
    }
  }
  out.sort((a, b) => b.blockTime - a.blockTime);
  return out;
}

/** Retry schedule from the worker FRD: 0 s, 30 s, 2 m, 10 m, 1 h (then 1 h), cap 8. */
export const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000, 3_600_000, 3_600_000, 3_600_000] as const;

/** 64 hex chars that look like an HMAC. Deterministic; not a real signature. */
export function fakeHmac(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    h1 = Math.imul(h1 ^ (h1 >>> 13), 0x5bd1e995) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 15), 0x27d4eb2f) >>> 0;
    out += ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

export function eventBody(e: Event): string {
  return JSON.stringify({ id: e.id, type: e.type, created: Math.floor(e.createdAt / 1000), livemode: e.livemode, data: { object: e.payload } }, null, 2);
}

/** One attempt: the request the worker would have sent, and what came back. */
export function makeAttempt(e: Event, at: number, outcome: { code: number | null; body?: string; error?: string | null }, manual = false): Attempt {
  const body = eventBody(e);
  const t = Math.floor(at / 1000);
  return {
    at,
    manual,
    requestHeaders: {
      "Content-Type": "application/json",
      "User-Agent": "Elapse/1.0 (+https://docs.elapse.finance/webhooks)",
      "X-Elapse-Event": e.id,
      "X-Elapse-Signature": `t=${t},v1=${fakeHmac(`${t}.${body}`)}`,
    },
    requestBody: body,
    responseCode: outcome.code,
    responseBody: outcome.body ?? null,
    error: outcome.error ?? null,
  };
}

/** Builds the delivery a worker would have produced for an event by now. */
export function deliverEvent(
  e: Event,
  ep: WebhookEndpoint,
  now: number,
  idFn: (p: string) => string,
  shape: "succeed" | "fail-then-succeed" | "exhaust" | "in-progress",
): Delivery {
  const d: Delivery = {
    id: idFn("dlv") as Delivery["id"],
    livemode: e.livemode,
    event: { id: e.id, type: e.type, objectId: e.objectId, createdAt: e.createdAt },
    endpoint: { id: ep.id, url: ep.url },
    status: "pending",
    attempt: 0,
    maxAttempts: 8,
    lastResponseCode: null,
    nextAttemptAt: e.createdAt,
    attempts: [],
  };
  if (ep.disabled) {
    d.status = "skipped";
    d.nextAttemptAt = null;
    return d;
  }
  const failOutcome = (n: number) =>
    n % 2 === 0 ? { code: 500, body: '{"error":"handler threw"}' } : { code: null, error: "connect ETIMEDOUT" };
  let at = e.createdAt;
  const plan = shape === "succeed" ? 1 : shape === "fail-then-succeed" ? 3 : shape === "exhaust" ? 8 : 2;
  for (let n = 0; n < plan; n++) {
    at = e.createdAt + RETRY_DELAYS_MS.slice(0, n + 1).reduce<number>((a, b) => a + b, 0);
    if (at > now) break;
    const last = n === plan - 1;
    const ok = (shape === "succeed" || shape === "fail-then-succeed") && last;
    d.attempts.push(makeAttempt(e, at, ok ? { code: 200, body: '{"received":true}' } : failOutcome(n)));
    d.attempt = n + 1;
    d.lastResponseCode = d.attempts[d.attempts.length - 1]!.responseCode;
    if (ok) {
      d.status = "succeeded";
      d.nextAttemptAt = null;
      return d;
    }
  }
  if (d.attempt >= 8) {
    d.status = "exhausted";
    d.nextAttemptAt = null;
  } else if (d.attempt > 0) {
    d.status = "failed";
    d.nextAttemptAt = e.createdAt + RETRY_DELAYS_MS.slice(0, d.attempt + 1).reduce<number>((a, b) => a + b, 0);
  } else {
    d.status = "pending";
  }
  return d;
}

export function subscribedTo(ep: WebhookEndpoint, type: Event["type"]): boolean {
  return ep.events === "*" || ep.events.includes(type);
}

export function successRate(deliveries: Delivery[], endpointId: string, now: number): number {
  const recent = deliveries.filter((d) => d.endpoint.id === endpointId && d.event.createdAt >= now - 7 * 86_400_000 && d.status !== "pending" && d.status !== "skipped");
  if (recent.length === 0) return 1;
  return recent.filter((d) => d.status === "succeeded").length / recent.length;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Random base-62 body for a key. Not for real secrets; the mock only. */
export function randomKeyBody(length = 32): string {
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function publishableKeyFor(livemode: boolean): string {
  return `pk_${livemode ? "live" : "test"}_${randomKeyBody(24)}`;
}

export function emptyData(livemode: boolean): MerchantData {
  return {
    products: [],
    customers: [],
    subscriptions: [],
    invoices: [],
    events: [],
    publishableKey: publishableKeyFor(livemode),
    keys: [],
    endpoints: [],
    deliveries: [],
    ledger: [],
    notifications: [],
  };
}

/** mulberry32: small, seedable, good enough for demo data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PRODUCTS: Array<Pick<Product, "name" | "description" | "rateUsdPerSecond" | "allowPause" | "status">> = [
  { name: "GPU · 4090", description: "One RTX 4090, billed while your job runs.", rateUsdPerSecond: "0.004", allowPause: true, status: "active" },
  { name: "GPU · H100", description: "One H100 80 GB.", rateUsdPerSecond: "0.012", allowPause: false, status: "active" },
  { name: "Transcription API", description: "Streaming speech-to-text, per connected second.", rateUsdPerSecond: "0.0005", allowPause: false, status: "active" },
  { name: "Live seat", description: "A seat in a live session.", rateUsdPerSecond: "0.0011", allowPause: true, status: "active" },
  { name: "GPU · 3090", description: "Retired.", rateUsdPerSecond: "0.0025", allowPause: false, status: "archived" },
];

const EMAILS = [
  "ana@driftlabs.io", "kofi@render.farm", "mei@quietstudio.co", "tomas@lumen.ai", "priya@northwind.dev",
  "yusuf@arc.studio", "lena@tapeworks.fm", "diego@foldpress.com", "sana@vertex.gg", "oleg@carrier.sh",
  "ines@bluefin.app", "ravi@halide.dev", "june@paperclip.tv", "noor@stack9.io", "leo@kilnworks.co",
];

/**
 * Gross, fee, net as 3-decimal strings where net is exactly gross − fee
 * *after* flooring each, so the three always reconcile on screen.
 */
export function money(grossNano: bigint, feeNano: bigint): Pick<Invoice, "grossUsd" | "feeUsd" | "netUsd"> {
  const grossUsd = formatUsd(grossNano, 3, { symbol: false });
  const feeUsd = formatUsd(feeNano, 3, { symbol: false });
  const netUsd = formatUsd(parseRate(grossUsd.replace(/,/g, "")) - parseRate(feeUsd.replace(/,/g, "")), 3, { symbol: false });
  return { grossUsd, feeUsd, netUsd };
}

function fee(grossNano: bigint, feeBps: number): bigint {
  return (grossNano * BigInt(feeBps)) / 10_000n;
}

/** Builds one mode's dataset. `scale` shrinks live mode. */
export function seedMerchantData(opts: {
  now: number;
  livemode: boolean;
  feeBps: number;
  scale?: number;
  seed?: number;
}): MerchantData {
  const { now, livemode, feeBps } = opts;
  const scale = opts.scale ?? 1;
  const r = rng(opts.seed ?? (livemode ? 7 : 3));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const tag = livemode ? "l" : "t";
  let n = 0;
  const id = (p: string) => `${p}_${tag}${(++n).toString(36).padStart(4, "0")}`;

  const products: Product[] = PRODUCTS.map((p, i) => ({
    ...p,
    id: id("prod") as Product["id"],
    livemode,
    activeSubscriptions: 0,
    createdAt: now - (20 - i * 2) * DAY,
  }));

  const customers: Customer[] = EMAILS.slice(0, Math.max(3, Math.round(15 * scale))).map((email, i) => ({
    id: id("cus") as Customer["id"],
    livemode,
    email: i % 5 === 4 ? null : email,
    createdAt: now - Math.round(r() * 18 * DAY),
    totalSettledUsd: "0",
    subscriptionCount: 0,
  }));

  const subscriptions: Subscription[] = [];
  const invoices: Invoice[] = [];
  const events: Event[] = [];
  const settledByCustomer = new Map<string, bigint>();

  const push = (type: EventType, objectId: string, at: number, payload: Record<string, unknown>) => {
    const failed = type !== "invoice.payment_failed" && r() < 0.06;
    events.push({
      id: id("evt") as Event["id"],
      livemode,
      type,
      objectId,
      createdAt: at,
      pendingWebhooks: 0,
      deliveryState: at > now - 20_000 ? "pending" : failed ? "failed" : "delivered",
      payload,
    });
  };

  const total = Math.max(4, Math.round(30 * scale));
  const statuses: SubscriptionStatus[] = ["active", "active", "active", "active", "canceled", "canceled", "canceled", "paused", "incomplete"];
  for (let i = 0; i < total; i++) {
    const product = pick(products.filter((p) => p.status === "active"));
    const customer = pick(customers);
    const status = i < 6 ? "active" : pick(statuses);
    const rate = parseRate(product.rateUsdPerSecond);
    // Every third non-active meter is recent, so the event log shows the
    // whole lifecycle (created, settled, canceled, paused) near the top.
    const recent = status !== "active" && i % 3 === 0;
    const createdAt = recent
      ? now - Math.round(r() * 90 * MIN) - 2 * MIN
      : now - Math.round(r() * 6 * DAY) - 2 * MIN;
    const startedAt = status === "incomplete" ? null : createdAt + 45_000;
    const fundedNano = BigInt(pick([5, 10, 25])) * NANO;
    const sub: Subscription = {
      id: id("sub") as Subscription["id"],
      livemode,
      status,
      product: { id: product.id, name: product.name },
      customer: { id: customer.id, email: customer.email },
      rateUsdPerSecond: product.rateUsdPerSecond,
      startedAt,
      pausedAt: null,
      canceledAt: null,
      fundedUsd: formatUsd(fundedNano, 2, { symbol: false }),
      settledUsd: "0.00",
      checkoutSession: id("cs") as Subscription["checkoutSession"],
      createdAt,
    };
    customer.subscriptionCount++;
    if (status === "incomplete") {
      subscriptions.push(sub);
      continue;
    }
    push("checkout.session.completed", sub.checkoutSession, startedAt!, { session: sub.checkoutSession, subscription: sub.id });
    push("subscription.created", sub.id, startedAt!, { subscription: sub.id, product: product.id, rate_usd_per_second: product.rateUsdPerSecond });

    // Keeper settles every ~10 minutes; the last pull is on cancel.
    const maxSeconds = Number(fundedNano / rate);
    let runSeconds: number;
    if (status === "active") {
      // Keep running meters young so they are clearly live and not exhausted.
      const ageMs = Math.min(now - startedAt!, Math.round((0.05 + r() * 0.5) * maxSeconds * 1000));
      sub.startedAt = now - ageMs;
      runSeconds = Math.floor(ageMs / 1000);
    } else {
      const cap = Math.floor((now - startedAt! - 30_000) / 1000);
      runSeconds = Math.max(1, Math.min(maxSeconds, cap, Math.round(r() * 3600) + 20));
    }
    let settledSeconds = 0;
    let settledTotal = 0n;
    const ticks = Math.floor(runSeconds / 600);
    for (let k = 1; k <= ticks; k++) {
      const secs = 600;
      const gross = settledNano(rate, secs);
      const f = fee(gross, feeBps);
      const at = sub.startedAt! + k * 600_000;
      settledSeconds += secs;
      settledTotal += gross;
      invoices.push({
        id: id("inv") as Invoice["id"],
        livemode,
        subscription: sub.id,
        customer: { id: customer.id, email: customer.email },
        settledAt: at,
        seconds: secs,
        ...money(gross, f),
        txId: `0x${(0x9a3f + n * 7919).toString(16).padStart(8, "0")}${"".padEnd(56, "3f")}`.slice(0, 66),
      });
      push("invoice.settled", sub.id, at, { subscription: sub.id, seconds: secs, amount_settled: formatUsd(gross, 3, { symbol: false }) });
    }
    if (status === "canceled") {
      const rest = runSeconds - settledSeconds;
      const gross = settledNano(rate, rest);
      const f = fee(gross, feeBps);
      const at = sub.startedAt! + runSeconds * 1000;
      settledTotal += gross;
      if (rest > 0) {
        invoices.push({
          id: id("inv") as Invoice["id"],
          livemode,
          subscription: sub.id,
          customer: { id: customer.id, email: customer.email },
          settledAt: at,
          seconds: rest,
          ...money(gross, f),
          txId: `0x${(0x1c07 + n * 7919).toString(16).padStart(8, "0")}${"".padEnd(56, "7a")}`.slice(0, 66),
        });
      }
      sub.canceledAt = at;
      // A session that used its whole cap ends by itself; the merchant is
      // told with invoice.payment_failed before the cancel (API FR-API-051).
      const capReached = r() < 0.3;
      sub.endedReason = capReached ? "cap_reached" : "canceled";
      if (capReached) {
        push("invoice.payment_failed", sub.id, at, { subscription: sub.id, reason: "cap_reached" });
      }
      push("subscription.canceled", sub.id, at, {
        subscription: sub.id,
        seconds_elapsed: runSeconds,
        amount_settled: formatUsd(settledTotal, 3, { symbol: false }),
        ended_reason: sub.endedReason,
      });
    } else if (status === "paused") {
      const at = sub.startedAt! + runSeconds * 1000;
      sub.pausedAt = at;
      sub.pauseReason = "user";
      push("subscription.updated", sub.id, at, { subscription: sub.id, status: "paused" });
    }
    sub.settledUsd = formatUsd(settledTotal, 3, { symbol: false });
    settledByCustomer.set(customer.id, (settledByCustomer.get(customer.id) ?? 0n) + settledTotal);
    if (status === "active") product.activeSubscriptions++;
    subscriptions.push(sub);
  }

  for (const c of customers) {
    c.totalSettledUsd = formatUsd(settledByCustomer.get(c.id) ?? 0n, 2, { symbol: false });
  }
  events.sort((a, b) => b.createdAt - a.createdAt);
  invoices.sort((a, b) => b.settledAt - a.settledAt);
  subscriptions.sort((a, b) => b.createdAt - a.createdAt);

  const mode = livemode ? "live" : "test";
  const keys: Omit<ApiKey, "status">[] = [
    { id: id("key") as ApiKey["id"], livemode, name: "Production server", prefix: `sk_${mode}_4f2a`, last4: "9d1c", createdAt: now - 19 * DAY, lastUsedAt: now - 3 * MIN, revokedAt: null, expiresAt: null },
    { id: id("key") as ApiKey["id"], livemode, name: "CI", prefix: `sk_${mode}_b81e`, last4: "77k2", createdAt: now - 12 * DAY, lastUsedAt: now - 2 * DAY, revokedAt: null, expiresAt: null },
    { id: id("key") as ApiKey["id"], livemode, name: "Laptop (old)", prefix: `sk_${mode}_0c3d`, last4: "m4q8", createdAt: now - 20 * DAY, lastUsedAt: now - 15 * DAY, revokedAt: now - 14 * DAY, expiresAt: null },
  ];

  const endpoints: WebhookEndpoint[] = [
    { id: id("wh") as WebhookEndpoint["id"], livemode, url: livemode ? "https://nimbus.example/webhooks/elapse" : "https://staging.nimbus.example/webhooks/elapse", events: "*", disabled: false, successRate7d: 1, previousSecretExpiresAt: null, createdAt: now - 18 * DAY },
  ];
  if (!livemode) {
    endpoints.push({ id: id("wh") as WebhookEndpoint["id"], livemode, url: "https://hooks.slack.example/T0/B0/nimbus-billing", events: ["invoice.payment_failed", "subscription.canceled"], disabled: true, successRate7d: 1, previousSecretExpiresAt: null, createdAt: now - 9 * DAY });
  }

  const deliveries: Delivery[] = [];
  events.forEach((e, i) => {
    for (const ep of endpoints) {
      if (!subscribedTo(ep, e.type)) continue;
      const shape = e.deliveryState === "pending" ? "in-progress" : e.deliveryState === "failed" ? (i % 2 === 0 ? "exhaust" : "in-progress") : i % 9 === 4 ? "fail-then-succeed" : "succeed";
      deliveries.push(deliverEvent(e, ep, now, id, shape));
    }
  });
  // Delivery state on events is a roll-up of their deliveries.
  for (const e of events) {
    const mine = deliveries.filter((d) => d.event.id === e.id && d.status !== "skipped");
    e.pendingWebhooks = mine.filter((d) => d.status === "pending" || d.status === "failed").length;
    e.deliveryState = mine.some((d) => d.status === "exhausted") ? "failed" : e.pendingWebhooks > 0 ? "pending" : "delivered";
  }
  for (const ep of endpoints) ep.successRate7d = successRate(deliveries, ep.id, now);

  const ledger = buildLedger(subscriptions, invoices, livemode, id);
  // One reversed row so the UI's re-org state is reachable.
  const settlements = ledger.filter((l) => l.kind === "settlement");
  if (settlements.length > 3) {
    const victim = settlements[3]!;
    const replacement: LedgerEntry = { ...victim, id: id("led") as LedgerEntry["id"], txId: victim.txId.replace(/.{4}$/, "beef"), blockTime: victim.blockTime + 1200 };
    victim.reversedBy = replacement.id;
    ledger.push(replacement);
    ledger.sort((a, b) => b.blockTime - a.blockTime);
  }

  const notifications: Notification[] = [];
  const exhausted = deliveries.filter((d) => d.status === "exhausted").slice(0, 3);
  for (const d of exhausted) {
    notifications.push({
      id: id("ntf") as Notification["id"],
      livemode,
      kind: "endpoint_exhausted",
      summary: `Delivery of ${d.event.type} to ${new URL(d.endpoint.url).host} stopped retrying after 8 attempts.`,
      objectId: d.id,
      href: `/dashboard/developers/webhooks/${d.endpoint.id}`,
      createdAt: d.attempts[d.attempts.length - 1]?.at ?? d.event.createdAt,
      readAt: null,
      emailedAt: d.attempts[d.attempts.length - 1]?.at ?? d.event.createdAt,
    });
  }
  for (const e of events.filter((x) => x.type === "invoice.payment_failed").slice(0, 3)) {
    notifications.push({
      id: id("ntf") as Notification["id"],
      livemode,
      kind: "payment_failed",
      summary: `A meter paused because its funds ran out (${e.objectId}).`,
      objectId: e.objectId,
      href: `/dashboard/subscriptions/${e.objectId}`,
      createdAt: e.createdAt,
      readAt: e.createdAt < now - 2 * DAY ? e.createdAt + 3600_000 : null,
      emailedAt: null,
    });
  }
  const firstOk = deliveries.filter((d) => d.status === "succeeded").sort((a, b) => a.event.createdAt - b.event.createdAt)[0];
  if (firstOk) {
    notifications.push({
      id: id("ntf") as Notification["id"],
      livemode,
      kind: "first_delivery",
      summary: "Your first webhook was delivered. The checklist is done.",
      objectId: firstOk.id,
      href: `/dashboard/developers/webhooks/${firstOk.endpoint.id}`,
      createdAt: firstOk.event.createdAt,
      readAt: firstOk.event.createdAt + 60_000,
      emailedAt: null,
    });
  }
  notifications.sort((a, b) => b.createdAt - a.createdAt);

  return {
    products,
    customers,
    subscriptions,
    invoices,
    events,
    publishableKey: publishableKeyFor(livemode),
    keys,
    endpoints,
    deliveries,
    ledger,
    notifications,
  };
}
