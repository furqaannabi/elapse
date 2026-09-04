/**
 * Funding math for the hosted checkout — how long a deposit lasts, when
 * to warn, what comes back. Pure functions over bigint nano-dollars.
 *
 * Maps to: FR-CHK-003, FR-CHK-006, FR-CHK-007, FR-CHK-008, BR-CHK-002.
 */
import { NANO, formatUsd } from "@/lib/meter/math";

/** Dollar presets the fund step offers (FR-CHK-003). */
export const FUND_PRESETS_USD = ["5", "10", "25"] as const;

/** Warn when less than this much runtime remains (FR-CHK-006). */
export const LOW_BALANCE_MS = 5 * 60_000;

const USD_PATTERN = /^\$?(\d+)(?:\.(\d{1,9}))?$/;

/**
 * Parses a USD amount ("10", "0.50", "$25") into nano-dollars.
 * @throws on empty, negative, or non-numeric input.
 */
export function parseUsd(input: string): bigint {
  const m = USD_PATTERN.exec(input.trim());
  if (!m) throw new Error(`Invalid amount "${input}"`);
  const [, whole, fraction = ""] = m;
  return BigInt(whole) * NANO + BigInt(fraction.padEnd(9, "0"));
}

/** Milliseconds a deposit buys at a rate. Infinity when the rate is zero. */
export function runtimeMsFor(fundedNano: bigint, rateNano: bigint): number {
  if (rateNano <= 0n) return Infinity;
  return Number((fundedNano * 1000n) / rateNano);
}

/** Runtime left after `elapsedMs` at the rate. Never negative. */
export function remainingRuntimeMs(
  fundedNano: bigint,
  rateNano: bigint,
  elapsedMs: number,
): number {
  const total = runtimeMsFor(fundedNano, rateNano);
  if (total === Infinity) return Infinity;
  return Math.max(0, total - Math.floor(elapsedMs));
}

export function isLowBalance(remainingMs: number): boolean {
  return remainingMs < LOW_BALANCE_MS;
}

/** Unused escrow returned on cancel: funded − settled, floored at zero. */
export function refundNano(fundedNano: bigint, settledNano: bigint): bigint {
  const r = fundedNano - settledNano;
  return r > 0n ? r : 0n;
}

/**
 * Human runtime: "≈ 45 s", "≈ 41 min", "≈ 3 h 20 min", "≈ 2 days".
 * Uses ≈ because the meter's precision is finer than the unit shown.
 */
export function formatRuntime(ms: number): string {
  if (ms === Infinity) return "unlimited";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `≈ ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rem = min % 60;
    return rem ? `≈ ${h} h ${rem} min` : `≈ ${h} h`;
  }
  const days = Math.floor(h / 24);
  return `≈ ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Receipt formatting: two decimals when the amount is whole cents, three
 * otherwise, so "$0.332" is never shown as "$0.33" next to a refund of
 * "$9.668". No symbol; callers add it.
 */
export function formatReceiptUsd(nano: bigint): string {
  const wholeCents = nano % 10_000_000n === 0n;
  return formatUsd(nano, wholeCents ? 2 : 3, { symbol: false });
}

/** Compact runtime for tight tiles: "45 s", "41 min", "1h 44m", "2 days". */
export function formatRuntimeShort(ms: number): string {
  if (ms === Infinity) return "unlimited";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rem = min % 60;
    return rem ? `${h}h ${rem}m` : `${h} h`;
  }
  const days = Math.floor(h / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
