/**
 * FR-EXM-157/158: whether Northwind may believe a subscription it did not learn from a webhook,
 * and in what state. Pure on purpose — the `subscriptions.retrieve` and `subscriptions.list` calls
 * live in the server and boot, so every branch here is testable without the SDK or a network.
 */

/** What `subscriptions.retrieve` came back with, reduced to what the decision needs. */
export type Retrieved =
  | { k: "found"; checkoutSession?: string; product: string; status: string }
  /** The platform answered, and this is not one of ours. */
  | { k: "not_found" }
  /** The platform did not answer. Says nothing about whether the subscription exists. */
  | { k: "unreachable" };

export type ClaimVerdict =
  /** Believe it: open the session `authorised` and consume the checkout session. */
  | { k: "adopt" }
  /** Already running: adopt it as the platform reports it, not as `authorised`. */
  | { k: "running"; status: "active" | "paused" }
  /** Spent — a new Checkout session is the right answer (FR-EXM-114). */
  | { k: "spent" }
  | { k: "refuse"; reason: "not_ours" | "unverifiable" };

export function claimVerdict(input: {
  retrieved: Retrieved;
  /** The `cs_` ids Northwind has issued and not yet consumed. */
  issued: ReadonlySet<string>;
  ourProduct: string;
}): ClaimVerdict {
  const { retrieved, issued, ourProduct } = input;
  // Only "unreachable" is not knowing. A 404 is the platform answering, and the answer is no.
  if (retrieved.k === "unreachable") return { k: "refuse", reason: "unverifiable" };
  if (retrieved.k === "not_found") return { k: "refuse", reason: "not_ours" };
  if (retrieved.product !== ourProduct) return { k: "refuse", reason: "not_ours" };
  if (!retrieved.checkoutSession || !issued.has(retrieved.checkoutSession)) {
    return { k: "refuse", reason: "not_ours" };
  }
  // FR-EXM-114: a meter the platform reports as gone is the one case where opening another
  // Checkout session is right.
  if (retrieved.status === "canceled") return { k: "spent" };
  // A meter that is already running is usable, so no new session — and its state is the platform's
  // to report, not the claim's to invent (FR-EXM-133).
  if (retrieved.status === "active" || retrieved.status === "paused") {
    return { k: "running", status: retrieved.status };
  }
  return { k: "adopt" };
}

/** A subscription as `subscriptions.list` reports it, reduced to what the decision needs. */
export type PlatformSubscription = {
  id: string;
  product: string;
  status: string;
  /** Epoch **seconds**, as the platform sends it. */
  started_at?: number | null;
};

export type Adopted = { sub: string; state: "active" | "paused"; startedAt: number };

/**
 * FR-EXM-158: the meters worth re-adopting after a restart. The session store is in memory, so a
 * restart loses every session the server was holding while the meters themselves keep running on
 * chain. This is the one place Northwind reads live status rather than receiving it as an event —
 * it is asking Elapse about Northwind's own subscriptions, with its own secret key, at a moment
 * when there are no webhooks to have missed.
 */
export function reconcileBoot(rows: readonly PlatformSubscription[], ourProduct: string): Adopted[] {
  const out: Adopted[] = [];
  for (const row of rows) {
    if (row.product !== ourProduct) continue;
    if (row.status !== "active" && row.status !== "paused") continue;
    if (!row.started_at) continue;
    out.push({ sub: row.id, state: row.status, startedAt: row.started_at * 1000 });
  }
  return out;
}
