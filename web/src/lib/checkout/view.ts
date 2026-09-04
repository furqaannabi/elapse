/**
 * `deriveView` — the one place that decides which checkout screen to show.
 *
 * Pure: takes the session and "now", returns a `CheckoutView`. The page
 * never branches on raw statuses; it renders the view this returns, so
 * every state is testable without a browser.
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
  if (session.status === "complete") return "used";
  if (!session.customer) return "signin";

  const funded = sub ? parseUsd(sub.fundedUsd) : 0n;
  if (!sub || funded <= 0n) return "fund";

  if (sub.status === "incomplete") return "ready";

  if (sub.status === "paused") {
    return sub.pauseReason === "out_of_funds" ? "out_of_funds" : "paused";
  }

  // active
  const rate = parseRate(sub.rateUsdPerSecond);
  const elapsed = elapsedMs({ startedAt: sub.startedAt ?? now, now, pausedAt: sub.pausedAt });
  const remaining = remainingRuntimeMs(funded, rate, elapsed);
  if (remaining <= 0) return "out_of_funds";
  if (isLowBalance(remaining)) return "low_balance";
  return "running";
}
