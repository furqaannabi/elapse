import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FR-EXM-036: this example runs at `/` locally and at a path prefix in production
 * (examples.elapse.finance/saas/). A root-absolute URL in the browser escapes the prefix: the page at
 * /saas/ asking for "/web.js" gets the other example's bundle, or nothing.
 */
const root = new URL("..", import.meta.url).pathname;
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name), ext) : ext.test(d.name) ? [join(dir, d.name)] : [],
  );

// "/x" but not "//cdn…" (protocol-relative) and not a full URL.
// sendBeacon too: the tab-close beacon is what ends a session, and a root path there fails silently.
const rootAbsolute = /\b(?:src|href)="\/(?!\/)[^"]*"|\b(?:fetch(?:Fn)?|sendBeacon)(?:\?\.)?\(\s*[`"']\/(?!\/)/g;

describe("FR-EXM-036 every URL the browser requests is relative", () => {
  it.each([...files("public", /\.html$/), ...files("src/web", /\.tsx?$/)])("%s", (file) => {
    const hits = readFileSync(join(root, file), "utf8").match(rootAbsolute) ?? [];
    expect(hits).toEqual([]);
  });
});
