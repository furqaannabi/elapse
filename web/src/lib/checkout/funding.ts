/**
 * Cap and runtime math for the hosted checkout — how long a cap lasts,
 * what it costs at most, when to warn, what comes back. Pure functions
 * over bigint nano-dollars.
 *
 * The subscriber chooses a duration, not an amount: the cap is the pot,
 * it cannot be raised mid-session, and the meter ends when it runs out
 * (FR-CHK-003, FR-CHK-007).
 *
 * Maps to: FR-CHK-003, FR-CHK-006, FR-CHK-007, FR-CHK-008, BR-CHK-002.
 */
import { NANO, formatUsd } from "@/lib/meter/math";

/** Duration presets the cap step offers, in seconds (FR-CHK-003). */
export const CAP_PRESETS_SECONDS = [3600, 14_400] as const;

/** Warn when less than this much runtime remains (FR-CHK-006). */
export const LOW_BALANCE_MS = 5 * 60_000;

const USD_PATTERN = /^\$?(\d+)(?:\.(\d{1,9}))?$/;
const MINUTES_PATTERN = /^(\d+)$/;

/**
 * The most a cap can cost: `rate × seconds`, exact in nano-dollars. This
 * is the number the subscriber signs for and the ceiling the contract
 * enforces (BR-CHK-002).
 */
export function maxEscrowNano(capSeconds: number, rateNano: bigint): bigint {
  if (capSeconds <= 0) return 0n;
  return BigInt(Math.floor(capSeconds)) * rateNano;
}

/**
 * Names a cap the way the copy says it: "1 hour", "4 hours", "25 min".
 * Used inside sentences ("About 5 min left of your 1 hour"), so it never
 * carries a ≈ or a leading capital.
 */
export function formatCap(capSeconds: number): string {
  const s = Math.floor(capSeconds);
  if (s < 60) return `${s} ${s === 1 ? "second" : "seconds"}`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (rem) return `${h} h ${rem} min`;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/**
 * Parses a custom cap typed in whole minutes.
 * @throws on empty, zero, negative, or non-numeric input.
 */
export function parseCapMinutes(input: string): number {
  const m = MINUTES_PATTERN.exec(input.trim());
  if (!m) throw new Error(`Invalid duration "${input}"`);
  const minutes = Number(m[1]);
  if (minutes <= 0) throw new Error(`Invalid duration "${input}"`);
  return minutes * 60;
}

/**
 * The instant a running meter uses up its cap, or `null` when the rate
 * cannot exhaust it. This is where the session ends (FR-CHK-007).
 */
export function capEndsAt(
  startedAt: number,
  capNano: bigint,
  rateNano: bigint,
): number | null {
  const runtime = runtimeMsFor(capNano, rateNano);
  return runtime === Infinity ? null : startedAt + runtime;
}

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

/** Milliseconds a cap buys at a rate. Infinity when the rate is zero. */
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

/** Unused escrow returned on cancel: cap − settled, floored at zero. */
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
