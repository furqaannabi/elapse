/**
 * FR-RCT-001: what `npm install @elapse/react` has to contain. These are the checks that would have
 * caught a 0.1.0 published with no stylesheet, no README, and an export pointing at TypeScript source.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  exports: Record<string, string | Record<string, string>>;
  files: string[];
};

/** Every `elapse-…` class the components render. */
function classesUsed(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(join(root, "src")).filter((f) => f.endsWith(".tsx"))) {
    for (const m of read(join("src", file)).matchAll(/className="([^"]+)"/g)) {
      for (const cls of m[1]!.split(/\s+/)) if (cls.startsWith("elapse")) names.add(cls);
    }
  }
  return [...names].sort();
}

describe("FR-RCT-001 packaging", () => {
  it("ships a stylesheet that styles every class the components render", () => {
    const css = read("styles.css");
    const missing = classesUsed().filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });

  it("styles.css declares the theme variables merchants override (FR-RCT-040)", () => {
    const css = read("styles.css");
    for (const v of ["--elapse-accent", "--elapse-radius", "--elapse-font", "--elapse-bg", "--elapse-fg", "--elapse-muted"]) {
      expect(css).toContain(v);
    }
  });

  it("exports no TypeScript source: every entry is a build output or a shipped asset", () => {
    const targets: string[] = [];
    for (const entry of Object.values(pkg.exports)) {
      if (typeof entry === "string") targets.push(entry);
      else targets.push(...Object.values(entry));
    }
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t, `${t} must not be published source`).not.toMatch(/^\.\/src\//);
      expect(t).toMatch(/^\.\/(dist\/|styles\.css$)/);
    }
  });

  it("builds the math subpath, so @elapse/react/math resolves off npm", () => {
    const tsup = read("tsup.config.ts");
    expect(tsup).toContain("src/math.ts");
    expect(pkg.exports["./math"]).toEqual({
      types: "./dist/math.d.ts",
      import: "./dist/math.js",
      require: "./dist/math.cjs",
    });
  });

  it("ships a CDN bundle a page with no bundler can load (ADR 2026-09-18)", () => {
    const tsup = read("tsup.config.ts");
    expect(tsup).toContain("src/browser.tsx");
    // React, react-dom and motion are bundled in: a plain page has nothing else to load.
    expect(tsup).toContain("noExternal");
    const j = JSON.parse(read("package.json")) as { jsdelivr?: string; unpkg?: string; exports: Record<string, unknown> };
    expect(j.jsdelivr).toBe("./dist/elapse.browser.js");
    expect(j.unpkg).toBe("./dist/elapse.browser.js");
    expect(j.exports["./browser"]).toBe("./dist/elapse.browser.js");
  });

  it("the built CDN bundle carries React and needs no import map", () => {
    const built = join(root, "dist/elapse.browser.js");
    if (!existsSync(built)) return expect(existsSync(join(root, "dist"))).toBe(false); // not built yet; CI builds first
    const js = readFileSync(built, "utf8");
    expect(js).not.toMatch(/from\s*"react(-dom)?(\/[\w.-]+)?"/);
    expect(js).toContain("mount");
  });

  it("has a README the npm page can show", () => {
    const readme = read("README.md");
    expect(readme).toContain("npm install @elapse/react");
    expect(readme).toContain("ElapseProvider");
    expect(readme).toContain("@elapse/react/styles.css");
    expect(readme).toContain("cdn.jsdelivr.net");
    expect(readme).not.toMatch(/wallet address|private key|seed phrase/i);
  });

  it("publishes the stylesheet and the README", () => {
    expect(pkg.files).toContain("styles.css");
    expect(pkg.files).toContain("README.md");
    expect(pkg.files).not.toContain("src/math.ts");
  });
});
