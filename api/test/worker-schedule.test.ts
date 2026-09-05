import { describe, expect, test } from "bun:test";
import { MAX_ATTEMPTS, RETRY_DELAYS_S, nextAttemptAt } from "../src/worker/schedule";

describe("FR-WRK-013 / BR-WRK-003 schedule", () => {
  test("exactly 0s, 30s, 2m, 10m, 1h, then 1h ×3; cap 8", () => {
    expect(RETRY_DELAYS_S).toEqual([0, 30, 120, 600, 3600, 3600, 3600, 3600]);
    expect(MAX_ATTEMPTS).toBe(8);
  });

  test("after failed attempt n (1-based) the next attempt is sent_at + delay[n]; after the 8th there is none", () => {
    const sentAt = new Date("2026-09-05T12:00:00Z");
    expect(nextAttemptAt(1, sentAt)?.getTime()).toBe(sentAt.getTime() + 30_000);
    expect(nextAttemptAt(2, sentAt)?.getTime()).toBe(sentAt.getTime() + 120_000);
    expect(nextAttemptAt(5, sentAt)?.getTime()).toBe(sentAt.getTime() + 3_600_000);
    expect(nextAttemptAt(7, sentAt)?.getTime()).toBe(sentAt.getTime() + 3_600_000);
    expect(nextAttemptAt(8, sentAt)).toBeNull();
  });
});
