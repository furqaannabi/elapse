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
 * FR-CHK-010, FR-CHK-034.
 */
import { elapsedMs, parseRate } from "@/lib/meter/math";
import { isLowBalance, parseUsd, remainingRuntimeMs } from "./funding";
import { CheckoutApiError } from "./mock-api";
import type { CheckoutSession, CheckoutView } from "./types";

export function deriveView(session: CheckoutSession, now: number): CheckoutView {
  if (session.status === "expired" || session.expiresAt <= now) return "expired";
  if (session.product.status === "archived") return "archived";

  const sub = session.subscription;
  if (sub?.status === "canceled") return "canceled";
  // FR-CHK-034: funded, waiting for the merchant to start. Merchant mode completes the session at funding,
  // so this comes before "used"; the mapper sets `hold` only when the money is really there.
  if (sub?.hold) return "held";
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

/**
 * FR-CHK-027: what the page does after a failed action. `sign_in_required` (a stale or
 * mismatched identity) reopens the sign-in sheet with "Sign in again."; every other error is
 * a toast with the API's own sentence, and nothing on the page names a chain.
 */
export function afterError(e: unknown): { message: string; openSignIn: boolean } {
  const message = e instanceof Error ? e.message : "Something went wrong";
  return { message, openSignIn: e instanceof CheckoutApiError && e.code === "sign_in_required" };
}

/**
 * FR-CHK-002: the primary action while the auth provider restores this device's session.
 * `pending` holds the button (one calm state instead of email → Face ID → Continue flashing);
 * `signin` means the step needs the wallet and the device has none; `ok` proceeds.
 */
export function actionGate(o: { ready: boolean; walletReady: boolean; needsWallet: boolean }): "pending" | "signin" | "ok" {
  if (!o.ready) return "pending";
  if (o.needsWallet && !o.walletReady) return "signin";
  return "ok";
}
