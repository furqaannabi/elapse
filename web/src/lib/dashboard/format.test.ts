import { describe, expect, it } from "vitest";
import { expiresIn, shortHex, shortId, timeAgo } from "./format";

const NOW = 1_756_800_000_000;

describe("format helpers", () => {
  it("timeAgo", () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 4 * 60_000, NOW)).toBe("4 min ago");
    expect(timeAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(timeAgo(NOW - 2 * 86_400_000, NOW)).toBe("2 d ago");
  });
  it("expiresIn", () => {
    expect(expiresIn(NOW, NOW)).toBe("now");
    expect(expiresIn(NOW + 12_000, NOW)).toBe("12 s");
    expect(expiresIn(NOW + 45 * 60_000, NOW)).toBe("45 m");
    expect(expiresIn(NOW + 24 * 3_600_000 - 1000, NOW)).toBe("23 h 59 m");
    expect(expiresIn(NOW + 24 * 3_600_000, NOW)).toBe("24 h");
  });
  it("shortId / shortHex", () => {
    expect(shortId("sub_t00a1")).toBe("sub_t00a1");
    expect(shortId("sub_abcdefghijkl")).toBe("sub_…ghijkl");
    expect(shortHex("0x9a3f1234567890abcdef7a3f")).toBe("0x9a3f…7a3f");
  });
});
