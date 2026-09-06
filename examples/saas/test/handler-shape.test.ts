import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FR-EXM-025 the handler stays small and documented", () => {
  const src = readFileSync(new URL("../src/webhooks.ts", import.meta.url), "utf8");
  it("is under 80 lines", () => {
    expect(src.split("\n").length).toBeLessThan(80);
  });
  it("carries the verify and handle regions the docs include", () => {
    for (const name of ["verify", "handle"]) {
      expect(src).toContain(`// region:${name}`);
    }
    expect(src.match(/\/\/ endregion/g)).toHaveLength(2);
  });
});
