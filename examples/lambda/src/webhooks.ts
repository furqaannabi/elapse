import { constructEvent } from "@elapse/sdk";
import type { createSessionStore } from "./session";

/**
 * FR-EXM-130/131: the whole webhook handler. Verify first, respond 2xx fast, then do the
 * merchant's work (BR-EXM-101/102). The webhook — not a timer — is the source of truth for
 * whether a session is open (FR-EXM-132).
 */

export type SessionStore = ReturnType<typeof createSessionStore>;

export interface WebhookDeps {
  secret: string;
  sessions: SessionStore;
  log: (line: string) => void;
  now: () => number;
  /** Print the event body after the header line. Default true. */
  logJson?: boolean;
}

export interface WebhookResponse {
  status: 200 | 400;
  body: string;
  /** Merchant work to run after the response is sent (BR-EXM-102). */
  work?: () => void;
}

export function handleWebhook(rawBody: string, signature: string | undefined, deps: WebhookDeps): WebhookResponse {
  const { secret, log } = deps;
  // region:verify
  let event;
  try {
    event = constructEvent(rawBody, signature, secret);
  } catch (err) {
    log(`✗ rejected: ${(err as Error).message}`);
    return { status: 400, body: JSON.stringify({ error: "invalid signature" }) };
  }
  // endregion
  // region:handle
  return {
    status: 200,
    body: JSON.stringify({ received: true }),
    work: () => {
      if (deps.sessions.seenEvent(event.id)) return log(`↺ duplicate ${event.id}`);
      const action = apply(event, deps);
      log(`${event.id}  ${event.type.padEnd(26)}→ ${action}`);
      if (deps.logJson !== false) log(JSON.stringify(event, null, 2));
    },
  };
  // endregion
}

/** Subscription fields this example reads off an Event (§5.3). */
interface SubObject {
  id?: string;
  customer?: string;
  status?: string;
  subscription?: string;
  started_at?: number;
  seconds_elapsed?: number;
  rate_usd_per_second?: string;
  amount_settled?: string;
}

/**
 * BR-EXM-106: gross the subscriber paid = rate × seconds, done on the decimal string with
 * integer math so a rate is never handed to parseFloat. Returns a plain decimal string.
 */
export function grossUsd(rate: string, seconds: number): string {
  const [whole = "0", frac = ""] = rate.trim().split(".");
  const scaled = BigInt(`${whole}${frac}`) * BigInt(Math.trunc(seconds));
  const digits = frac.length;
  if (digits === 0) return scaled.toString();
  const s = scaled.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** Two-decimal display of a decimal string, for a line a subscriber reads. */
export function displayUsd(amount: string): string {
  const [whole = "0", frac = ""] = amount.split(".");
  const cents = `${frac}00`.slice(0, 2);
  return `${whole}.${cents}`;
}

function apply(event: { type: string; data: { object: unknown } }, deps: WebhookDeps): string {
  const o = event.data.object as SubObject;
  const sub = o.id ?? "";
  const nowMs = deps.now();

  switch (event.type) {
    case "checkout.session.completed": {
      // The session id and the subscription it became arrive together (§5.3).
      if (o.id && o.subscription) deps.sessions.linkCheckout(o.id, o.subscription);
      return "provision session";
    }
    case "subscription.created": {
      // FR-EXM-133: a merchant-mode Product creates the Subscription `incomplete` — the subscriber
      // has paid into escrow and nothing accrues until the first Run starts the meter (FR-EXM-125).
      if (o.status !== "active") {
        deps.sessions.applyAuthorised(sub, { ...(o.customer ? { customer: o.customer } : {}), nowMs });
        return `session authorised ${sub}`;
      }
      const startedAt = o.started_at ? o.started_at * 1000 : nowMs;
      deps.sessions.applyOpen(sub, { ...(o.customer ? { customer: o.customer } : {}), startedAt, nowMs });
      return `session open ${sub}`;
    }
    case "subscription.updated": {
      // FR-EXM-133: this is the event the first Run waits for — the chain confirmed the start.
      // FR-EXM-153: it is also how the meter going on and off between runs reaches this server.
      if (o.status === "active") {
        deps.sessions.applyActive(sub, { startedAt: o.started_at ? o.started_at * 1000 : nowMs, nowMs });
        return `meter started ${sub}`;
      }
      if (o.status === "paused") {
        deps.sessions.applyPaused(sub, { nowMs });
        return `meter paused ${sub}`;
      }
      return `sync session (${o.status ?? "unknown"})`;
    }
    case "subscription.canceled": {
      const seconds = o.seconds_elapsed ?? 0;
      const paid = o.rate_usd_per_second ? grossUsd(o.rate_usd_per_second, seconds) : (o.amount_settled ?? "0");
      deps.sessions.applyClosed(sub, { secondsElapsed: seconds, paidUsd: paid, nowMs });
      return `session closed · ${seconds}s · $${displayUsd(paid)}`;
    }
    case "invoice.settled":
      return `book revenue $${o.amount_settled ?? "0"}`;
    case "invoice.payment_failed":
      deps.sessions.applyClosed(sub, { nowMs });
      return "session closed (payment failed)";
    default:
      return "ignored";
  }
}
