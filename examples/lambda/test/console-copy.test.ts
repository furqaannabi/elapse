/**
 * FR-EXM-153/155: the pages say what the code does.
 *
 * This file has now been inverted once, which is the point of keeping it rather than replacing it.
 * It was written on 2026-09-19, when FR-EXM-153 had just been amended so a session **ended** with
 * its run: it asserted that the landing must not sell "the seconds your session is open" and that
 * both pages must say the seconds the *code* runs. Signed 2026-09-21 ([ADR](../../../docs/decisions/2026-09-21-the-lambda-meter-runs-until-you-end-it.md)),
 * the session runs on wall-clock time until the subscriber ends it, so the true sentence is the one
 * this file used to forbid. The assertions move with the behaviour; what does not move is the rule
 * they enforce — a page may not describe a lifecycle the server does not implement.
 *
 * Inverted a second time on 2026-09-26 ([ADR](../../../docs/decisions/2026-09-26-lambda-session-ends-with-its-run.md),
 * Furqaan): the session ends with its run again, so the 2026-09-19 assertions come back — nothing
 * pauses, the pages bill for the seconds the code runs, and there is no End control to offer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const console_ = read("../src/web/console.tsx");
const landing = read("../public/index.html");
const consolePage = read("../public/console.html");

/** HTML wraps where it likes and the browser collapses it, so the assertions have to as well. */
const phrase = (words: string) => new RegExp(words.split(" ").join("\\s+"), "i");

describe("FR-EXM-153 the pages say what the code does", () => {
  /** Only what reaches the screen: a comment may say why something is gone; a string may not. */
  const shown = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never tells the subscriber a session is paused, because none ever is", () => {
    const paused = [...shown(console_).matchAll(/^.*\bPaused?\b.*$/gim)].map((m) => m[0].trim());
    expect(paused, `${paused.join(" / ")} — the session ends with the run; nothing pauses`).toEqual([]);
  });

  it("does not bill anyone for a session merely being open", () => {
    for (const [name, page] of [["landing", landing], ["console", consolePage]] as const) {
      expect(page, `${name}: the session ends with the run, so an open session is not what is billed`).not.toMatch(
        phrase("seconds your session is open"),
      );
    }
  });

  it("bills for running code on both pages, in the same words", () => {
    for (const [name, page] of [["landing", landing], ["console", consolePage]] as const) {
      expect(shown(page), `${name} should say the seconds are the ones the code runs`).toMatch(phrase("seconds your code runs"));
    }
  });

  it("offers no End control, because every session ends itself", () => {
    expect(shown(console_), "FR-EXM-155 is withdrawn").not.toMatch(/End session/);
    expect(shown(landing), "the landing should not tell anyone to press End").not.toMatch(/Press End/i);
  });

  it("does not call a meter running when the run that would have started it failed", () => {
    // 2026-09-23, from the recording: a start refused because the escrow had not ingested yet came
    // back 503, and the console set the running status anyway — so the page said the meter was on
    // and costing money while nothing had started.
    expect(console_, "a failed run must not set the running status").not.toMatch(
      /outcome\.k === "error"[\s\S]{0,300}SETTLING_STATUS/,
    );
    expect(console_).toMatch(/RUN_FAILED_STATUS/);
  });

  it("says whose choice it is that leaving ends the meter", () => {
    // FR-EXM-126: a run in flight still ends if its tab goes. Without this, a judge who watches a
    // closed tab cancel a subscription concludes Elapse cannot bill anything that outlives a tab.
    expect(console_, "the console should name the merchant as the one who ends on leaving").toMatch(/never calls cancel/i);
  });

  it("never runs a clock on the landing", () => {
    // William, 2026-09-21: "what time is running on landing page with a button, that is misleading,
    // no time should be running there". The meter belongs on the console, where it is real.
    expect(landing, "the landing should carry no script at all").not.toMatch(/<script/i);
    expect(landing, "nothing on the landing should be counting").not.toMatch(/setInterval|requestAnimationFrame|Date\.now/);
  });

  it("opens the console with an instruction, not a state readout", () => {
    const idle = console_.match(/const IDLE_STATUS = "([^"]+)"/)?.[1] ?? "";
    expect(idle, "the first line a subscriber reads should tell them what to do").toMatch(/Press Run/i);
  });
});

describe("FR-EXM-157 the console never answers a refusal with a second authorisation", () => {
  it("claims the subscription before it runs, and renders the refusal instead of <Authorize>", () => {
    // Enforced on the source because the alternative — a console that treats "Northwind could not
    // confirm your session" as "no session yet" — is exactly the loop that stranded three
    // authorisations of $7.20 on 2026-09-22.
    expect(console_).toMatch(/postClaim/);
    const claim = console_.slice(console_.indexOf("const authorised"), console_.indexOf("const onRun"));
    expect(claim).toMatch(/postClaim\(fetch, found\)/);
    expect(claim).toMatch(/refused/);
    // The refusal must not put the page back into the authorising phase.
    expect(claim).not.toMatch(/k: "authorising"[\s\S]{0,200}refused/);
  });
});
