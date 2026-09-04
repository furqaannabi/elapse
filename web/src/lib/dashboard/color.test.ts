import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex } from "./color";

describe("accent contrast (FR-DSH-103)", () => {
  it("parses 3- and 6-digit hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("f5b74a")).toEqual([245, 183, 74]);
    expect(parseHex("blue")).toBeNull();
  });
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#f5b74a", "#0a0a0a")!).toBeGreaterThan(3);
    expect(contrastRatio("#1a1a1a", "#0a0a0a")!).toBeLessThan(3);
    expect(contrastRatio("nope", "#000")).toBeNull();
  });
});
