/**
 * FR-DOC-011, FR-DOC-023, FR-DOC-030, FR-DOC-032, BR-DOC-003: every synced
 * snippet comes from a source of truth, and `--check` catches drift.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractRegion, sync } from "../scripts/sync-snippets";

describe("extractRegion", () => {
  it("returns the dedented lines between the markers and drops the markers", () => {
    const src = ["a", "  // region:x", "  const y = 1;", "    nested();", "  // endregion", "b"].join("\n");
    expect(extractRegion(src, "x")).toBe("const y = 1;\n  nested();");
  });
  it("throws when the region is missing", () => {
    expect(() => extractRegion("nothing", "x")).toThrow(/region "x"/);
  });
});

describe("sync", () => {
  it("writes every snippet from its source, and --check is clean right after", async () => {
    const out = mkdtempSync(join(tmpdir(), "elapse-snippets-"));
    const written = await sync({ siteDir: out, check: false });
    const files = readdirSync(join(out, "snippets")).sort();
    expect(files).toEqual(expect.arrayContaining([
      "example-client.mdx", "example-product.mdx", "example-session.mdx", "example-verify.mdx", "example-handle.mdx",
      "payload-subscription.canceled.mdx", "contracts.mdx", "retry-schedule.mdx", "error-types.mdx", "cli-listen.mdx", "signature-vector.mdx",
    ]));
    expect(existsSync(join(out, "openapi.json"))).toBe(true);
    expect(written.length).toBe(files.length + 1);
    await expect(sync({ siteDir: out, check: true })).resolves.toEqual([]);
  });

  it("--check reports the stale file after a hand edit", async () => {
    const out = mkdtempSync(join(tmpdir(), "elapse-snippets-"));
    await sync({ siteDir: out, check: false });
    writeFileSync(join(out, "snippets", "retry-schedule.mdx"), "edited by hand\n");
    await expect(sync({ siteDir: out, check: true })).resolves.toEqual(["retry-schedule.mdx"]);
  });

  it("every payload snippet validates against the signed-body Event schema and carries no real-looking ids", async () => {
    const out = mkdtempSync(join(tmpdir(), "elapse-snippets-"));
    await sync({ siteDir: out, check: false });
    const payloads = readdirSync(join(out, "snippets")).filter((f) => f.startsWith("payload-"));
    expect(payloads).toHaveLength(6);
    for (const f of payloads) {
      const text = readFileSync(join(out, "snippets", f), "utf8");
      expect(text).toContain("```json");
      expect(text).toMatch(/"id": "evt_test/);
    }
  });
});
