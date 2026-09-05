/**
 * @elapse/sdk — per-second billing, integrated like Stripe.
 * Server-side only (Node 20+). The frozen surface (SDK FRD FR-SDK-007):
 * `Elapse`, `products`, `checkout.sessions`, `subscriptions`, `customers`,
 * `invoices`, `webhooks.constructEvent`, the error classes and the types.
 */
import { ElapseInvalidRequestError } from "./errors";
import { Transport, type RequestOptions } from "./http";
import { checkout, customers, invoices, products, subscriptions } from "./resources";
import { constructEvent, type ConstructEventOptions } from "./webhooks";

export interface ElapseConfig {
  /** `sk_test_…` or `sk_live_…`, usually `process.env.ELAPSE_SECRET_KEY`. Server-side only. `undefined` throws at construction. */
  secretKey: string | undefined;
  /** Defaults to `https://api.elapse.dev`. */
  baseUrl?: string;
  /** Transient-failure retries (network, 429, 5xx). Default 2. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
}

export class Elapse {
  readonly #transport: Transport;
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;

  readonly products: ReturnType<typeof products>;
  readonly checkout: ReturnType<typeof checkout>;
  readonly subscriptions: ReturnType<typeof subscriptions>;
  readonly customers: ReturnType<typeof customers>;
  readonly invoices: ReturnType<typeof invoices>;

  readonly webhooks = {
    /** Verify a webhook and parse the event. Pass the raw body, never a parsed object. */
    constructEvent: (rawBody: string | Uint8Array, header: string | undefined, secret: string | readonly string[] | undefined, options?: ConstructEventOptions) =>
      constructEvent(rawBody, header, secret, options),
  };

  constructor(config: ElapseConfig) {
    if (typeof globalThis !== "undefined" && "window" in globalThis && typeof (globalThis as { document?: unknown }).document !== "undefined") {
      throw new ElapseInvalidRequestError("@elapse/sdk is server-side only: your secret key must never reach a browser.");
    }
    if (!config || typeof config.secretKey !== "string" || config.secretKey.length === 0) {
      throw new ElapseInvalidRequestError("Missing secretKey. Pass { secretKey: 'sk_test_…' } from your server environment.");
    }
    this.baseUrl = (config.baseUrl ?? "https://api.elapse.dev").replace(/\/+$/, "");
    this.maxRetries = config.maxRetries ?? 2;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.#transport = new Transport({ secretKey: config.secretKey, baseUrl: this.baseUrl, maxRetries: this.maxRetries, timeoutMs: this.timeoutMs });
    this.products = products(this.#transport);
    this.checkout = checkout(this.#transport);
    this.subscriptions = subscriptions(this.#transport);
    this.customers = customers(this.#transport);
    this.invoices = invoices(this.#transport);
  }

  /** Test hook: override the retry sleep. Not part of the public surface. */
  set _sleep(fn: (ms: number) => Promise<void>) {
    this.#transport._sleep = fn;
  }

  /** Never leak the key through logging (BR-SDK-002). */
  toJSON(): { baseUrl: string } {
    return { baseUrl: this.baseUrl };
  }
}

export { constructEvent };
export type { ConstructEventOptions, RequestOptions };
export type { CheckoutSession, Customer, Invoice, List, ListParams, Product, Subscription } from "./resources";
export * from "./errors";
export * from "./events";
