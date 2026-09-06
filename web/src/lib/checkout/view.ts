/**
 * `deriveView` — the one place that decides which checkout screen to show.
 *
 * Pure: takes the session and "now", returns a `CheckoutView`. The page
 * never branches on raw statuses; it renders the view this returns, so
 * every state is testable without a browser.
 *
 * A meter that has used its whole cap reads as `canceled`: the session
 * ends there (FR-CHK-007), so the page shows the receipt without waiting
 * for the server to agree.
 *
 * Maps to: FR-CHK-002, FR-CHK-004, FR-CHK-006, FR-CHK-007, FR-CHK-008,
 * FR-CHK-010.
 */
import { elapsedMs, parseRate } from "@/lib/meter/math";
import { isLowBalance, parseUsd, remainingRuntimeMs } from "./funding";
import type { CheckoutSession, CheckoutView } from "./types";

export function deriveView(session: CheckoutSession, now: number): CheckoutView {
  if (session.status === "expired" || session.expiresAt <= now) return "expired";
  if (session.product.status === "archived") return "archived";

  const sub = session.subscription;
  if (sub?.status === "canceled") return "canceled";
  // The API marks a session `complete` the moment its meter starts (FR-API-033); a running or
  // paused meter is still this subscriber's, so "already used" is only a complete session
  // whose meter is not live for them.
  const live = sub?.status === "active" || sub?.status === "paused";
  if (session.status === "complete" && !live) return "used";
  if (!session.customer && !session.signedIn) return "signin";

  const funded = sub ? parseUsd(sub.fundedUsd) : 0n;
  if (!sub || funded <= 0n) return "cap";

  if (sub.status === "incomplete") return "ready";
  if (sub.status === "paused") return "paused";

  // active
  const rate = parseRate(sub.rateUsdPerSecond);
  const elapsed = elapsedMs({ startedAt: sub.startedAt ?? now, now, pausedAt: sub.pausedAt });
  const remaining = remainingRuntimeMs(funded, rate, elapsed);
  if (remaining <= 0) return "canceled";
  if (isLowBalance(remaining)) return "low_balance";
  return "running";
}
