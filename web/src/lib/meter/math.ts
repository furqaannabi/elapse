/**
 * Meter math — the arithmetic behind "you only pay what elapsed".
 *
 * All money is carried as bigint nano-dollars (1 USD = 1_000_000_000n)
 * so that display math never touches floating point. Rates arrive from
 * the API as decimal strings and are parsed once; the live counter accrues
 * with millisecond resolution for smoothness, while settlement uses whole
 * seconds to match the contract (`secs * ratePerSecond`).
 *
 * Maps to: CLAUDE.md "The meter"; detailed doc §7 step 4, §9 contracts.
 */

/** Nano-dollars per USD. */
export const NANO = 1_000_000_000n;

const RATE_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const MAX_DECIMALS = 9;

/**
 * Parses a USD-per-second rate string ("0.004") into nano-dollars per second.
 *
 * @param rate - Non-negative decimal string with at most nine decimals.
 * @returns Rate in nano-dollars per second.
 * @throws If the string is empty, negative, scientific, or too precise.
 */
export function parseRate(rate: string): bigint {
  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) throw new Error(`Invalid rate "${rate}": expected a decimal string`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > MAX_DECIMALS) {
    throw new Error(
      `Invalid rate "${rate}": precision beyond ${MAX_DECIMALS} decimals`,
    );
  }
  const padded = fraction.padEnd(MAX_DECIMALS, "0");
  return BigInt(whole) * NANO + BigInt(padded);
}

export type ElapsedInput = {
  /** Epoch ms when the meter started. */
  startedAt: number;
  /** Epoch ms "now" — injected so the math is deterministic in tests. */
  now: number;
  /** Epoch ms when the meter was paused or canceled; freezes elapsed. */
  pausedAt?: number | null;
};

/**
 * Milliseconds the meter has run. Never negative; frozen at `pausedAt`.
 */
export function elapsedMs({ startedAt, now, pausedAt }: ElapsedInput): number {
  const end = pausedAt ?? now;
  return Math.max(0, end - startedAt);
}

/** Whole seconds elapsed — what the contract settles on. */
export function wholeSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Live accrual: rate × elapsed, floored to the nano-dollar.
 *
 * @param rateNano - Rate in nano-dollars per second.
 * @param ms - Elapsed milliseconds.
 */
export function accruedNano(rateNano: bigint, ms: number): bigint {
  return (rateNano * BigInt(Math.floor(ms))) / 1000n;
}

/**
 * Settled amount for whole seconds — mirrors `AccrualStream.settle`.
 * Always ≤ the live accrual for the same elapsed span.
 */
export function settledNano(rateNano: bigint, seconds: number): bigint {
  return rateNano * BigInt(seconds);
}

/** Rate scaled to a minute, for the "~$0.24 / minute" reminder. */
export function perMinute(rateNano: bigint): bigint {
  return rateNano * 60n;
}

/** Rate scaled to an hour, for the "~$14.40 / hour" reminder. */
export function perHour(rateNano: bigint): bigint {
  return rateNano * 3600n;
}

export type FormatUsdOptions = {
  /** Prefix with "$". Default true. */
  symbol?: boolean;
};

/**
 * Formats nano-dollars as a USD string, flooring to `decimals` places so a
 * subscriber never sees a cent they have not yet accrued.
 *
 * @param nano - Amount in nano-dollars.
 * @param decimals - 2 for receipts and tables, 3 for the live counter.
 */
export function formatUsd(
  nano: bigint,
  decimals: 2 | 3 = 2,
  { symbol = true }: FormatUsdOptions = {},
): string {
  const negative = nano < 0n;
  const abs = negative ? -nano : nano;
  const divisor = 10n ** BigInt(MAX_DECIMALS - decimals);
  const scaled = abs / divisor;
  const unit = 10n ** BigInt(decimals);
  const whole = scaled / unit;
  const fraction = (scaled % unit).toString().padStart(decimals, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${symbol ? "$" : ""}${grouped}.${fraction}`;
}

export type ElapsedParts = {
  hours: string;
  minutes: string;
  seconds: string;
  tenths: string;
};

/**
 * Formats elapsed milliseconds as "hh:mm:ss". Hours grow past 99 rather
 * than wrapping. With `{ parts: true }` returns the fields separately so
 * the instrument display can set each digit group in its own cell.
 */
export function formatElapsed(ms: number): string;
export function formatElapsed(ms: number, opts: { parts: true }): ElapsedParts;
export function formatElapsed(
  ms: number,
  opts?: { parts?: boolean },
): string | ElapsedParts {
  const total = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: ElapsedParts = {
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
    tenths: String(Math.floor((total % 1000) / 100)),
  };
  if (opts?.parts) return parts;
  return `${parts.hours}:${parts.minutes}:${parts.seconds}`;
}
