/**
 * FR-DOC-002: the left nav has exactly nine top-level entries in this order.
 * FR-DOC-025: no placeholder pages. Read straight from docs.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const docs = JSON.parse(readFileSync(new URL("../site/docs.json", import.meta.url), "utf8")) as {
  navigation: { pages: Array<string | { group: string; pages?: unknown[]; openapi?: string }> };
};

const title = (e: string | { group: string }) => (typeof e === "string" ? e : e.group);

describe("FR-DOC-002 navigation", () => {
  it("has the nine entries in order", () => {
    expect(docs.navigation.pages.map(title)).toEqual([
      "introduction",
      "quickstart",
      "checkout",
      "subscriptions",
      "Webhooks",
      "sdks",
      "API reference",
      "contracts",
      "testing",
    ]);
  });

  it("renders the reference from the synced OpenAPI file, never hand-written pages", () => {
    const ref = docs.navigation.pages.find((e) => typeof e !== "string" && e.group === "API reference") as { openapi?: string; pages?: unknown[] };
    expect(ref.openapi).toBe("openapi.json");
    expect(ref.pages).toEqual(["api-reference/authentication", "api-reference/errors"]);
  });
});
