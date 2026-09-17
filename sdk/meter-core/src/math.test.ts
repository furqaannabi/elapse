/**
 * Behaviour tests for the meter math.
 *
 * The meter is the product: these tests pin down that a subscriber is
 * never over-charged, that display math never touches floats, and that
 * the readouts format the way the brief specifies ("00:01:23", "$0.33").
 *
 * Maps to: CLAUDE.md "The meter"; detailed doc §7 step 4.
 */
import { describe, expect, it } from "vitest";
import {
  accruedNano,
  elapsedMs,
  formatElapsed,
  formatUsd,
  parseRate,
  perHour,
  perMinute,
  settledNano,
  wholeSeconds,
} from "./math";

describe("parseRate", () => {
  it("parses a decimal USD-per-second string into nano-dollars", () => {
    expect(parseRate("0.004")).toBe(4_000_000n);
    expect(parseRate("1")).toBe(1_000_000_000n);
    expect(parseRate("0.000001")).toBe(1_000n);
  });

  it("accepts up to nine decimal places and rejects more", () => {
    expect(parseRate("0.123456789")).toBe(123_456_789n);
    expect(() => parseRate("0.1234567891")).toThrow(/precision/);
  });

  it("rejects negative, empty, or non-numeric rates", () => {
    expect(() => parseRate("-1")).toThrow();
    expect(() => parseRate("")).toThrow();
    expect(() => parseRate("abc")).toThrow();
    expect(() => parseRate("1e-3")).toThrow();
  });
});

describe("elapsedMs", () => {
  const started = 1_756_800_000_000;

  it("is zero before start and grows with now", () => {
    expect(elapsedMs({ startedAt: started, now: started })).toBe(0);
    expect(elapsedMs({ startedAt: started, now: started + 83_400 })).toBe(
      83_400,
    );
  });

  it("never goes negative when clocks disagree", () => {
    expect(elapsedMs({ startedAt: started, now: started - 500 })).toBe(0);
  });

  it("freezes at pausedAt when paused, ignoring now", () => {
    expect(
      elapsedMs({
        startedAt: started,
        pausedAt: started + 10_000,
        now: started + 99_000,
      }),
    ).toBe(10_000);
  });
});

describe("accruedNano", () => {
  it("accrues rate × elapsed with millisecond resolution, flooring", () => {
    const rate = parseRate("0.004");
    expect(accruedNano(rate, 1_000)).toBe(4_000_000n);
    expect(accruedNano(rate, 83_000)).toBe(332_000_000n);
    // 4_000_000 * 1 / 1000 = 4000 exactly; 4_000_000 * 1.5 / 1000 → floor
    expect(accruedNano(rate, 1)).toBe(4_000n);
    expect(accruedNano(parseRate("0.000000001"), 1)).toBe(0n);
  });
});

describe("settledNano / wholeSeconds", () => {
  it("settles on whole seconds only, matching the contract", () => {
    const rate = parseRate("0.004");
    expect(wholeSeconds(83_999)).toBe(83);
    expect(settledNano(rate, wholeSeconds(83_999))).toBe(332_000_000n);
  });

  it("never settles more than the live accrual shows", () => {
    const rate = parseRate("0.0037");
    const ms = 12_345;
    expect(settledNano(rate, wholeSeconds(ms))).toBeLessThanOrEqual(
      accruedNano(rate, ms),
    );
  });
});

describe("formatUsd", () => {
  it("formats nano-dollars with two decimals by default, flooring", () => {
    expect(formatUsd(332_000_000n)).toBe("$0.33");
    expect(formatUsd(339_999_999n)).toBe("$0.33");
    expect(formatUsd(0n)).toBe("$0.00");
  });

  it("supports three decimals for the live counter", () => {
    expect(formatUsd(332_000_000n, 3)).toBe("$0.332");
    expect(formatUsd(4_000_000n, 3)).toBe("$0.004");
  });

  it("groups thousands", () => {
    expect(formatUsd(1_234_567_890_000_000n)).toBe("$1,234,567.89");
  });

  it("can omit the symbol", () => {
    expect(formatUsd(332_000_000n, 2, { symbol: false })).toBe("0.33");
  });
});

describe("formatElapsed", () => {
  it("renders hh:mm:ss, zero-padded", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(83_000)).toBe("00:01:23");
    expect(formatElapsed(3_599_999)).toBe("00:59:59");
    expect(formatElapsed(3_600_000)).toBe("01:00:00");
  });

  it("lets hours grow past two digits instead of wrapping", () => {
    expect(formatElapsed(100 * 3_600_000)).toBe("100:00:00");
  });

  it("can split into parts for the instrument display", () => {
    expect(formatElapsed(83_450, { parts: true })).toEqual({
      hours: "00",
      minutes: "01",
      seconds: "23",
      tenths: "4",
    });
  });
});

describe("perMinute / perHour", () => {
  it("derives the human-scale rates the checkout shows", () => {
    const rate = parseRate("0.004");
    expect(formatUsd(perMinute(rate))).toBe("$0.24");
    expect(formatUsd(perHour(rate))).toBe("$14.40");
  });
});
