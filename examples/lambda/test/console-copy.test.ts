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
  it("bills for the session being open on both pages, in the same words", () => {
    for (const [name, page] of [["landing", landing], ["console", consolePage]] as const) {
      expect(page, `${name} should say the seconds are the ones the session is open`).toMatch(phrase("seconds your session is open"));
    }
  });

  it("no longer claims anywhere that the session ends with the run", () => {
    for (const [name, page] of [["landing", landing], ["console page", consolePage], ["console", console_]] as const) {
      expect(page, `${name} still describes the superseded per-run lifecycle`).not.toMatch(/(ends?|closes?)\s+with\s+(the|your)\s+run/i);
    }
  });

  it("explains a pause the subscriber did not ask for", () => {
    // FR-EXM-154: the sweep pauses an idle meter. <Meter> narrates the pauses a subscriber asked
    // for (FR-RCT-046); an automatic one has no other voice, and a meter that silently stops
    // reads as a meter that broke.
    const shown = console_.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const paused = shown.match(/const AUTO_PAUSED = "([^"]+)"/)?.[1] ?? "";
    expect(paused, "the automatic pause should say it happened and why").toMatch(/paused/i);
    expect(paused, "and what to do about it").toMatch(/run|resume/i);
  });

  it("says whose choice it is that leaving ends the meter", () => {
    // FR-EXM-155: without this, a judge who watches a closed tab cancel a subscription concludes
    // Elapse cannot bill anything that outlives a tab. It can; Northwind chooses not to ask it to.
    expect(console_, "the console should name the merchant as the one who ends on leaving").toMatch(/never calls cancel/i);
  });

  it("offers the subscriber a way to end the session", () => {
    expect(console_, "FR-EXM-155: the gesture the product exists to show").toMatch(/End session/);
  });

  it("never runs a clock on the landing", () => {
    // William, 2026-09-21: "what time is running on landing page with a button, that is misleading,
    // no time should be running there". A meter that ticks before a subscriber has agreed to
    // anything reads as a charge already in progress, whatever the caption underneath says — and on
    // a page whose whole claim is billing honesty that is the one thing worth getting right. The
    // meter belongs on the console, where it is real and the subscriber asked for it.
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
    const claim = console_.slice(console_.indexOf("const authorised"), console_.indexOf("const ask = ("));
    expect(claim).toMatch(/postClaim\(fetch, found\)/);
    expect(claim).toMatch(/refused/);
    // The refusal must not put the page back into the authorising phase.
    expect(claim).not.toMatch(/k: "authorising"[\s\S]{0,200}refused/);
  });
});
