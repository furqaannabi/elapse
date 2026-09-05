import { describe, expect, test } from "bun:test";
import { decimalToBaseUnits, isDecimalString } from "../src/lib/money";

describe("BR-API-004 decimal money", () => {
  test("accepts canonical decimal strings only", () => {
    for (const ok of ["0", "1", "0.004", "12.5", "0.000001", "100000000"]) expect(isDecimalString(ok)).toBe(true);
    for (const bad of ["", ".5", "1.", "-1", "+1", "1e-3", "0x10", "1,5", " 1", "1 ", "abc", "1.2.3"]) expect(isDecimalString(bad)).toBe(false);
  });

  test("converts to base units exactly (6 decimals)", () => {
    expect(decimalToBaseUnits("0.004", 6)).toBe(4000n);
    expect(decimalToBaseUnits("1", 6)).toBe(1_000_000n);
    expect(decimalToBaseUnits("0.000001", 6)).toBe(1n);
    expect(decimalToBaseUnits("14.4", 6)).toBe(14_400_000n);
    expect(decimalToBaseUnits("0.100000", 6)).toBe(100_000n);
  });

  test("returns null when the value is not representable or malformed", () => {
    expect(decimalToBaseUnits("0.0000001", 6)).toBeNull();
    expect(decimalToBaseUnits("0.0040001", 6)).toBeNull();
    expect(decimalToBaseUnits("1e-3", 6)).toBeNull();
    expect(decimalToBaseUnits("0.0000001", 18)).toBe(100_000_000_000n);
  });

  test("never goes through a float", () => {
    // 0.1 + 0.2 territory: exact in decimal, wrong in binary.
    expect(decimalToBaseUnits("0.3", 18)).toBe(300_000_000_000_000_000n);
    expect(decimalToBaseUnits("123456789.123456", 6)).toBe(123_456_789_123_456n);
  });
});
