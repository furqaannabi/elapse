/** Money for display, from the shared meter math (ADR 2026-09-17; BR-RCT-005: never a float). */
import { formatUsd, parseRate } from "./math";

export const CAP_PRESETS_SECONDS = [3_600, 14_400] as const;

/** The most a cap can cost: rate × seconds, in nano-dollars. */
export function escrowNano(rateUsdPerSecond: string, seconds: number): bigint {
  return parseRate(rateUsdPerSecond) * BigInt(seconds);
}

/** "$14.40", or three decimals when the amount is not whole cents, so "$0.332" is never shown as "$0.33". */
export function formatAmount(nano: bigint): string {
  return formatUsd(nano, nano % 10_000_000n === 0n ? 2 : 3);
}

/** "1 hour", "4 hours", "90 minutes". */
export function formatCap(seconds: number): string {
  if (seconds % 3_600 === 0) {
    const h = seconds / 3_600;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}
