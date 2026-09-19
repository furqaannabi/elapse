/** FR-DOC-042: the SDK, the SDKs page, and the OpenAPI file name the same methods. */
import { describe, expect, it } from "vitest";
import { diff, documentedMethods, sdkMethods, specOperations } from "../ci/surface-check";

describe("FR-DOC-042 surface check", () => {
  // Ten since FR-SDK-009 `subscriptions.start` (frozen-surface change signed 2026-09-14).
  it("SDK has twelve REST methods", () => {
    // Ten through 0.2.0; FR-SDK-044 (signed 2026-09-19) adds subscriptions.pause and .resume.
    expect(sdkMethods()).toHaveLength(12);
  });
  it("parses ### `method` headings and ignores webhooks.constructEvent", () => {
    expect(documentedMethods("### `products.create`\n\ntext\n### `webhooks.constructEvent`\n### `invoices.list`\n")).toEqual(["invoices.list", "products.create"]);
  });
  it("the synced openapi.json and the SDKs page match the SDK exactly", () => {
    expect(diff(sdkMethods(), specOperations())).toEqual({ onlyA: [], onlyB: [] });
    expect(diff(sdkMethods(), documentedMethods())).toEqual({ onlyA: [], onlyB: [] });
  });
});
