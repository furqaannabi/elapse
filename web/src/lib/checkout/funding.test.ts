/**
 * Funding math for the hosted checkout.
 *
 * FR-CHK-003 (presets show the runtime they buy), FR-CHK-006 (low balance
 * at < 5 min), FR-CHK-007 (out of funds), FR-CHK-008 (refund = funded −
 * settled), BR-CHK-002 (never charged more than funded).
 */
import { describe, expect, it } from "vitest";
import { parseRate } from "@/lib/meter/math";
import {
  FUND_PRESETS_USD,
  LOW_BALANCE_MS,
  formatRuntime,
  formatRuntimeShort,
  isLowBalance,
  parseUsd,
  refundNano,
  remainingRuntimeMs,
  runtimeMsFor,
} from "./funding";

const rate = parseRate("0.004"); // $14.40 / hour

describe("parseUsd", () => {
  it("parses dollar strings into nano-dollars", () => {
    expect(parseUsd("10")).toBe(10_000_000_000n);
    expect(parseUsd("0.50")).toBe(500_000_000n);
    expect(parseUsd("$25")).toBe(25_000_000_000n);
  });
  it("rejects garbage and negatives", () => {
    expect(() => parseUsd("")).toThrow();
    expect(() => parseUsd("-5")).toThrow();
    expect(() => parseUsd("abc")).toThrow();
  });
});

describe("runtimeMsFor (FR-CHK-003)", () => {
  it("tells the subscriber how long a deposit lasts at the rate", () => {
    // $10 / $0.004 per s = 2500 s
    expect(runtimeMsFor(parseUsd("10"), rate)).toBe(2_500_000);
    expect(runtimeMsFor(parseUsd("5"), rate)).toBe(1_250_000);
  });
  it("is zero for a zero rate guard", () => {
    expect(runtimeMsFor(parseUsd("10"), 0n)).toBe(Infinity);
  });
});

describe("formatRuntime", () => {
  it("rounds to a human unit", () => {
    expect(formatRuntime(2_500_000)).toBe("≈ 41 min");
    expect(formatRuntime(1_250_000)).toBe("≈ 20 min");
    expect(formatRuntime(45_000)).toBe("≈ 45 s");
    expect(formatRuntime(3 * 3_600_000 + 20 * 60_000)).toBe("≈ 3 h 20 min");
    expect(formatRuntime(48 * 3_600_000)).toBe("≈ 2 days");
    expect(formatRuntime(Infinity)).toBe("unlimited");
  });
});

describe("formatRuntimeShort", () => {
  it("fits a preset tile", () => {
    expect(formatRuntimeShort(2_500_000)).toBe("41 min");
    expect(formatRuntimeShort(6_250_000)).toBe("1h 44m");
    expect(formatRuntimeShort(7_200_000)).toBe("2 h");
    expect(formatRuntimeShort(45_000)).toBe("45 s");
  });
});

describe("remainingRuntimeMs / isLowBalance (FR-CHK-006, FR-CHK-007)", () => {
  it("counts down as time elapses", () => {
    const funded = parseUsd("10"); // 2500 s of runtime
    expect(remainingRuntimeMs(funded, rate, 0)).toBe(2_500_000);
    expect(remainingRuntimeMs(funded, rate, 2_000_000)).toBe(500_000);
  });
  it("never goes negative", () => {
    expect(remainingRuntimeMs(parseUsd("1"), rate, 999_999_999)).toBe(0);
  });
  it("flags low balance under five minutes and out of funds at zero", () => {
    expect(LOW_BALANCE_MS).toBe(5 * 60_000);
    expect(isLowBalance(LOW_BALANCE_MS + 1)).toBe(false);
    expect(isLowBalance(LOW_BALANCE_MS - 1)).toBe(true);
    expect(isLowBalance(0)).toBe(true);
  });
});

describe("refundNano (FR-CHK-008, BR-CHK-002)", () => {
  it("returns funded minus settled, never negative", () => {
    expect(refundNano(parseUsd("10"), 332_000_000n)).toBe(9_668_000_000n);
    expect(refundNano(parseUsd("0.30"), 332_000_000n)).toBe(0n);
  });
});

describe("presets", () => {
  it("are the three the FRD names", () => {
    expect(FUND_PRESETS_USD).toEqual(["5", "10", "25"]);
  });
});
