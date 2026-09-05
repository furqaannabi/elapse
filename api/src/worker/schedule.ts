/**
 * Retry schedule (worker FR-WRK-013, BR-WRK-003; CLAUDE.md). Index n is the
 * delay applied *after* failed attempt n (1-based): attempt 1 fails → retry
 * in 30 s, … attempt 5 fails → 1 h, attempts 6–7 fail → 1 h each, attempt 8
 * fails → exhausted. Index 0 (0 s) is the first attempt itself.
 * Change only by editing the FRD.
 */
export const RETRY_DELAYS_S: readonly number[] = [0, 30, 120, 600, 3600, 3600, 3600, 3600];
export const MAX_ATTEMPTS = 8;

/** When to try again after failed attempt `n`, or null when the cap is reached. */
export function nextAttemptAt(n: number, sentAt: Date): Date | null {
  if (n >= MAX_ATTEMPTS) return null;
  return new Date(sentAt.getTime() + RETRY_DELAYS_S[n]! * 1000);
}
