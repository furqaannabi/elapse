import { ElapseInvalidRequestError } from "./errors";
import type { SubscriptionObject, SubscriptionStatus } from "./events";
import type { RequestOptions, Transport } from "./http";

/** Stripe-style list page (API FR-API-080). */
export interface List<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}

export interface ListParams {
  /** 1–100, default 10. */
  limit?: number;
  /** Id of the last object of the previous page. */
  startingAfter?: string;
}

export interface Product {
  id: string;
  object: "product";
  name: string;
  description: string | null;
  /** USD per second, decimal string. Never parse it to a number for money math. */
  rate_usd_per_second: string;
  rate_per_second_wei: string;
  currency: "ausd";
  allow_pause: boolean;
  active: boolean;
  livemode: boolean;
  created: number;
}

export interface CheckoutSession {
  id: string;
  object: "checkout.session";
  status: "open" | "complete" | "expired";
  /** Send the subscriber here. */
  url: string;
  livemode: boolean;
  created: number;
  expires_at: number;
  success_url: string;
  cancel_url: string;
  product: Product;
  merchant: { name: string; logo_url: string | null; accent: string | null; support_url: string | null };
  customer: string | null;
  subscription: string | null;
  max_duration_seconds: number | null;
  max_escrow_usd: string | null;
}

export type Subscription = SubscriptionObject;

export interface Customer {
  id: string;
  object: "customer";
  email: string | null;
  livemode: boolean;
  created: number;
  [extra: string]: unknown;
}

export interface Invoice {
  id: string;
  object: "invoice";
  subscription: string;
  period_start: number;
  period_end: number;
  seconds: number;
  amount_settled: string;
  gross: string;
  fee: string;
  net: string;
  currency: "ausd";
  status: "paid" | "failed";
  livemode: boolean;
  created: number;
}

const DECIMAL = /^\d+(\.\d+)?$/;
const STATUSES: readonly SubscriptionStatus[] = ["incomplete", "active", "paused", "canceled"];

function assertId(id: unknown, prefix: string, name: string): string {
  if (typeof id !== "string" || !id.startsWith(`${prefix}_`) || id.length <= prefix.length + 1) {
    throw new ElapseInvalidRequestError(`${name} must be an id starting with '${prefix}_'.`, { param: name });
  }
  return id;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** `products.create/retrieve/list` (FR-SDK-002, FR-SDK-003). */
export function products(t: Transport) {
  return {
    create(params: { name: string; rateUsdPerSecond: string; allowPause?: boolean; description?: string }, opts?: RequestOptions): Promise<Product> {
      if (typeof params.rateUsdPerSecond !== "string" || !DECIMAL.test(params.rateUsdPerSecond)) {
        return Promise.reject(
          new ElapseInvalidRequestError('rateUsdPerSecond must be a decimal string such as "0.004" (never a number).', { param: "rateUsdPerSecond" }),
        );
      }
      const body: Record<string, unknown> = { name: params.name, rate_usd_per_second: params.rateUsdPerSecond };
      if (params.allowPause !== undefined) body.allow_pause = params.allowPause;
      if (params.description !== undefined) body.description = params.description;
      return t.request<Product>("POST", "/products", body, opts);
    },
    retrieve(id: string, opts?: RequestOptions): Promise<Product> {
      return Promise.resolve()
        .then(() => assertId(id, "prod", "id"))
        .then((v) => t.request<Product>("GET", `/products/${v}`, undefined, opts));
    },
    list(params: ListParams = {}, opts?: RequestOptions): Promise<List<Product>> {
      return t.request<List<Product>>("GET", `/products${query({ limit: params.limit, starting_after: params.startingAfter })}`, undefined, opts);
    },
  };
}

/** `checkout.sessions.create` (FR-SDK-004). */
export function checkout(t: Transport) {
  return {
    sessions: {
      create(params: { product: string; successUrl: string; cancelUrl: string; maxDurationSeconds?: number }, opts?: RequestOptions): Promise<CheckoutSession> {
        return Promise.resolve()
          .then(() => assertId(params.product, "prod", "product"))
          .then((product) => {
            const body: Record<string, unknown> = { product, success_url: params.successUrl, cancel_url: params.cancelUrl };
            if (params.maxDurationSeconds !== undefined) body.max_duration_seconds = params.maxDurationSeconds;
            return t.request<CheckoutSession>("POST", "/checkout/sessions", body, opts);
          });
      },
    },
  };
}

/** `subscriptions.retrieve/list/cancel` (FR-SDK-005, FR-SDK-008). No pause or resume. */
export function subscriptions(t: Transport) {
  return {
    retrieve(id: string, opts?: RequestOptions): Promise<Subscription> {
      return Promise.resolve()
        .then(() => assertId(id, "sub", "id"))
        .then((v) => t.request<Subscription>("GET", `/subscriptions/${v}`, undefined, opts));
    },
    list(params: ListParams & { customer?: string; product?: string; status?: SubscriptionStatus } = {}, opts?: RequestOptions): Promise<List<Subscription>> {
      if (params.status !== undefined && !STATUSES.includes(params.status)) {
        return Promise.reject(new ElapseInvalidRequestError(`status must be one of ${STATUSES.join(", ")}.`, { param: "status" }));
      }
      return t.request<List<Subscription>>(
        "GET",
        `/subscriptions${query({ customer: params.customer, product: params.product, status: params.status, limit: params.limit, starting_after: params.startingAfter })}`,
        undefined,
        opts,
      );
    },
    /** Asks the platform to end the meter; the `canceled` status arrives via webhook once the chain confirms (API FR-API-042). */
    cancel(id: string, opts?: RequestOptions): Promise<Subscription> {
      return Promise.resolve()
        .then(() => assertId(id, "sub", "id"))
        .then((v) => t.request<Subscription>("POST", `/subscriptions/${v}/cancel`, {}, opts));
    },
  };
}

/** `customers.retrieve` (FR-SDK-006). */
export function customers(t: Transport) {
  return {
    retrieve(id: string, opts?: RequestOptions): Promise<Customer> {
      return Promise.resolve()
        .then(() => assertId(id, "cus", "id"))
        .then((v) => t.request<Customer>("GET", `/customers/${v}`, undefined, opts));
    },
  };
}

/** `invoices.list` (FR-SDK-006). */
export function invoices(t: Transport) {
  return {
    list(params: ListParams & { subscription?: string; customer?: string } = {}, opts?: RequestOptions): Promise<List<Invoice>> {
      return t.request<List<Invoice>>(
        "GET",
        `/invoices${query({ subscription: params.subscription, customer: params.customer, limit: params.limit, starting_after: params.startingAfter })}`,
        undefined,
        opts,
      );
    },
  };
}
