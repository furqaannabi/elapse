/**
 * FR-DOC-002: the left nav has exactly ten top-level entries in this order (Payouts added by
 * FR-DOC-046; SDKs became a group over TypeScript and React on 2026-09-21).
 * FR-DOC-025: no placeholder pages. Read straight from docs.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const docs = JSON.parse(readFileSync(new URL("../site/docs.json", import.meta.url), "utf8")) as {
  navigation: { pages: Array<string | { group: string; pages?: unknown[]; openapi?: string }> };
  redirects?: Array<{ source: string; destination: string }>;
};

const title = (e: string | { group: string }) => (typeof e === "string" ? e : e.group);

describe("FR-DOC-002 navigation", () => {
  it("has the ten entries in order", () => {
    expect(docs.navigation.pages.map(title)).toEqual([
      "introduction",
      "quickstart",
      "checkout",
      "subscriptions",
      "payouts",
      "Webhooks",
      "SDKs",
      "API reference",
      "contracts",
      "testing",
    ]);
  });

  it("puts both packages under SDKs, TypeScript before React", () => {
    const sdks = docs.navigation.pages.find((e) => typeof e !== "string" && e.group === "SDKs") as { pages?: unknown[] };
    expect(sdks.pages).toEqual(["sdks/typescript", "sdks/react"]);
  });

  it("redirects the paths those two pages used to live at", () => {
    expect(docs.redirects).toEqual([
      { source: "/sdks", destination: "/sdks/typescript" },
      { source: "/react", destination: "/sdks/react" },
    ]);
  });

  it("renders the reference from the synced OpenAPI file, never hand-written pages", () => {
    const ref = docs.navigation.pages.find((e) => typeof e !== "string" && e.group === "API reference") as { openapi?: string; pages?: unknown[] };
    expect(ref.openapi).toBe("openapi.json");
    expect(ref.pages).toEqual(["api-reference/authentication", "api-reference/errors"]);
  });
});
