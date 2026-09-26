/**
 * FR-EXM-152: the console's meter wears Northwind's colours — "the meter on elapse.finance, in
 * Northwind's colours", "in the slot `<Authorize>` occupies".
 *
 * This test is structural on purpose. The thing that can break is a CSS cascade: `northwind.css`
 * scopes every meter rule under `.screen`, so the theme reaches the meter only while the console
 * renders it inside one. A cascade cannot be executed without a browser, and this package has no
 * DOM library, so the relationship between the two files is asserted directly. It fails from
 * either side — moving the meter out of `.screen`, or unscoping the stylesheet without moving it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const console_ = read("../src/web/console.tsx");
const northwind = read("../public/northwind.css");

/**
 * The JSX guarded by `phase.k === "session"` that renders the meter. There has been more than one
 * such branch (the End session control, FR-EXM-155, withdrawn 2026-09-26), so this finds the one
 * that actually contains `<Meter>` rather than whichever comes first, and closes it by counting
 * brackets instead of matching a fixed indent, since the meter's nesting depth is not the test's
 * business.
 */
function sessionBranch(src: string): string {
  // FR-EXM-152 amended 2026-09-26: the meter renders for the session `meterShown` picks — the live one,
  // or the last one once it has ended — not only while a session is live.
  const guard = "{shown && (";
  // The JSX tag, not the prose: this file's own header comment mentions `<Meter>` too.
  const meter = src.search(/<Meter\n/);
  expect(meter, "the console should render a meter").toBeGreaterThan(-1);
  let start = -1;
  for (let i = src.indexOf(guard); i > -1 && i < meter; i = src.indexOf(guard, i + 1)) start = i;
  expect(start, "the meter should sit behind a session guard").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i);
    }
  }
  throw new Error("the session branch never closes");
}

describe("FR-EXM-152 the console's meter wears Northwind's colours", () => {
  it("scopes its meter rules under .screen, so the meter must be rendered inside one", () => {
    const rules = [...northwind.matchAll(/^([^{\n]*\.elapse[^{\n]*)\{/gm)].map((m) => m[1]!.trim());
    expect(rules.length, "northwind.css should dress the meter at all").toBeGreaterThan(0);
    for (const selector of rules) {
      expect(selector, `"${selector}" would not reach a meter inside .screen`).toContain(".screen");
    }
  });

  it("renders <Meter> inside .screen, so Northwind's rules reach it", () => {
    const branch = sessionBranch(console_);
    expect(branch, "the session branch should render the meter").toContain("<Meter");
    const screen = branch.indexOf('className="screen"');
    expect(screen, "the meter is outside .screen, so Northwind's rules never reach it").toBeGreaterThan(-1);
    expect(screen, "the .screen wrapper should open before the meter").toBeLessThan(branch.indexOf("<Meter"));
  });

  it("puts <Authorize> inside .screen too, so both phases are dressed the same", () => {
    const start = console_.indexOf('{phase.k === "authorising" && (');
    const branch = console_.slice(start, console_.indexOf("\n      )}", start));
    expect(branch.indexOf('className="screen"')).toBeLessThan(branch.indexOf("<Authorize"));
  });

  /**
   * The wrapping rules for a readout — `white-space: pre-wrap`, `word-break`, `overflow-x` — are
   * written as `.screen pre`, a descendant selector. A `<pre>` that carries `className="screen"`
   * itself is not a `pre` inside a `.screen`, so it takes the box and none of the wrapping, and a
   * long line runs outside the bezel instead of folding. Every `<pre>` therefore nests.
   */
  it("never puts .screen on a <pre> itself, or its long lines escape the box", () => {
    const wrapping = northwind.match(/^\.screen pre \{[^}]*\}/m);
    expect(wrapping?.[0], "northwind.css should wrap readouts via `.screen pre`").toContain("pre-wrap");

    const selfScreened = [...console_.matchAll(/<pre\b[^>]*className="screen"/g)].map((m) => m[0]);
    expect(selfScreened, `${selfScreened.join(", ")} — wrap it in <div className="screen"> instead`).toEqual([]);
  });
});

describe("FR-EXM-152 amended: the ended meter stays on screen", () => {
  it("renders the meter for the session meterShown picks, keyed so a new session gets a new meter", () => {
    expect(console_).toMatch(/const shown = meterShown\(phase, ended\)/);
    const branch = sessionBranch(console_);
    expect(branch).toMatch(/<Meter\s[\s\S]*?key=\{shown\}/);
    expect(branch).toMatch(/session=\{shown\}/);
  });
});
