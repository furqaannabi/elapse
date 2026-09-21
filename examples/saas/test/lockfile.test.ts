import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * FR-EXM-001: this example must work from a copy outside the monorepo — `git clone`, `npm install`,
 * `npm start`. That is what the CI job does, and what a judge does.
 */
describe("FR-EXM-001 the example installs outside the workspace", () => {
  it("has a lockfile that names no path inside this monorepo", () => {
    // Running `npm install` in here while it sits in the pnpm workspace makes npm record the
    // symlinks pnpm left in node_modules: {"resolved": "../../node_modules/.pnpm/…", "link": true}.
    // Copied to /tmp those paths do not exist, so the install silently omits the package and
    // `npm start` dies on the first import. Regenerate from a copy outside the repo instead.
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
      packages: Record<string, { link?: boolean; resolved?: string }>;
    };
    const linked = Object.entries(lock.packages)
      .filter(([, v]) => v.link === true || (v.resolved?.startsWith("..") ?? false))
      .map(([k]) => k);
    expect(linked).toEqual([]);
  });
});
