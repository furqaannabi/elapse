/**
 * CLAUDE.md: "Rates are decimal strings, never floats, until converted to wei." The console's
 * hourly reminder is display money, but it is still money arithmetic, and `micros()` already exists
 * three lines below it — a float here is the thing the next person copies.
 */
import { describe, expect, it } from "vitest";
import { hourly } from "../src/server";

describe("FR-EXM-110 the hourly reminder is computed from the decimal string", () => {
  it.each([
    ["0.002", "7.20"],
    ["0.004", "14.40"],
    ["0.0000014", "0.01"],
    ["0.000001", "0.00"],
    ["1.5", "5400.00"],
  ])("renders %s per second as $%s per hour", (rate, expected) => {
    expect(hourly(rate)).toBe(expected);
  });
});
