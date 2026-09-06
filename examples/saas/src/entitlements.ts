import type { ElapseEvent } from "@elapse/sdk";

/**
 * FR-EXM-022/023: the merchant's in-memory state. One set of seen Event ids
 * (redeliveries are no-ops, BR-EXM-004) and one map from Subscription id to
 * whether that customer is allowed in. Replace with your database.
 */

export interface Entitlement {
  entitled: boolean;
  /** Why: `active`, `paused`, `canceled`, `payment failed`, `pending webhook`. */
  reason: string;
  customer: string;
  updated_at: number;
}

export class Entitlements {
  readonly #seen = new Set<string>();
  readonly #bySubscription = new Map<string, Entitlement>();
  readonly #bySession = new Map<string, string>();

  /** True the first time an Event id is seen; false on a redelivery. */
  first(eventId: string): boolean {
    if (this.#seen.has(eventId)) return false;
    this.#seen.add(eventId);
    return true;
  }

  /** Applies the §5.1 merchant action and returns the one-line description of what was done. */
  apply(event: ElapseEvent): string {
    const o = event.data.object as Record<string, unknown>;
    const sub = String(o.subscription ?? o.id ?? "");
    const set = (entitled: boolean, reason: string) =>
      this.#bySubscription.set(sub, { entitled, reason, customer: String(o.customer ?? this.#bySubscription.get(sub)?.customer ?? ""), updated_at: event.created });
    switch (event.type) {
      case "checkout.session.completed":
        this.#bySession.set(String(o.id), sub);
        set(false, "pending webhook");
        return `provision access ${sub}`;
      case "subscription.created":
        set(true, "active");
        return `mark entitled ${sub}`;
      case "subscription.updated": {
        const status = String(o.status);
        set(status === "active", status);
        return `sync entitlement (${status}) ${sub}`;
      }
      case "subscription.canceled":
        set(false, "canceled");
        return `revoke access · ${o.seconds_elapsed}s · $${o.amount_settled}`;
      case "invoice.settled":
        return `book revenue $${o.amount_settled} ${sub}`;
      case "invoice.payment_failed":
        set(false, "payment failed");
        return `revoke access (payment failed) ${sub}`;
      default:
        return "ignored";
    }
  }

  /** FR-EXM-011: the success page knows only the session id until `checkout.session.completed` arrives. */
  forSession(sessionId: string): ({ subscription: string } & Entitlement) | undefined {
    const sub = this.#bySession.get(sessionId);
    const e = sub ? this.#bySubscription.get(sub) : undefined;
    return sub && e ? { subscription: sub, ...e } : undefined;
  }

  /** FR-EXM-012: the merchant's "is this customer allowed in" check. */
  get(subscriptionId: string): { entitled: boolean; reason: string } {
    const e = this.#bySubscription.get(subscriptionId);
    return e ? { entitled: e.entitled, reason: e.reason } : { entitled: false, reason: "unknown subscription" };
  }
}
