/**
 * The public checkout session, read with the publishable key from the merchant's own page
 * (API FR-API-031, CORS FR-API-140(c)). Only what the components draw is mapped.
 */
import type { ElapseConfig } from "./provider";

export interface PublicSubscription {
  id: string;
  status: "incomplete" | "active" | "paused" | "canceled";
  startedAt: number | null;
  pausedAt: number | null;
  maxDurationSeconds: number;
  fundedUsd: string;
  maxEscrowUsd: string;
  settledUsd: string;
  secondsElapsed: number;
  endedReason: "canceled" | "cap_reached" | null;
  chainId: number;
  startMode: "checkout" | "merchant";
  /** Epoch ms when an unstarted merchant-mode meter comes back if never started (FR-API-137). */
  startBy: number | null;
  subscriberCanStop: boolean;
}

export interface PublicSession {
  id: string;
  status: "open" | "complete" | "expired";
  merchant: { name: string; successUrl: string; cancelUrl: string };
  product: { name: string; rateUsdPerSecond: string; allowPause: boolean; startMode: "checkout" | "merchant" };
  subscription: PublicSubscription | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapSession(w: any): PublicSession {
  const s = w.subscription;
  return {
    id: w.id,
    status: w.status,
    merchant: { name: w.merchant.name, successUrl: w.merchant.success_url, cancelUrl: w.merchant.cancel_url },
    product: {
      name: w.product.name,
      rateUsdPerSecond: w.product.rate_usd_per_second,
      allowPause: Boolean(w.product.allow_pause),
      startMode: w.product.start_mode === "merchant" ? "merchant" : "checkout",
    },
    subscription: s
      ? {
          id: s.id,
          status: s.status,
          startedAt: s.started_at === null ? null : s.started_at * 1000,
          pausedAt: s.paused_at === null ? null : s.paused_at * 1000,
          maxDurationSeconds: s.max_duration_seconds,
          fundedUsd: s.funded_usd,
          maxEscrowUsd: s.max_escrow_usd,
          settledUsd: s.settled_usd,
          secondsElapsed: s.seconds_elapsed,
          endedReason: s.ended_reason ?? null,
          chainId: s.chain_id,
          startMode: s.start_mode === "merchant" ? "merchant" : "checkout",
          startBy: typeof s.start_by === "number" ? s.start_by * 1000 : null,
          subscriberCanStop: s.subscriber_can_stop !== false,
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchPublicSession(config: ElapseConfig, id: string): Promise<PublicSession> {
  const res = await config.fetch(`${config.baseUrl}/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${config.publishableKey}` },
  });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? "We couldn't load this session.");
  return mapSession(body);
}
