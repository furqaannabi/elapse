/**
 * FR-EXM-153: "the meter runs only while code runs", amended 2026-09-19 so the session **ends**
 * when the run does rather than pausing between runs.
 *
 * The behaviour was amended; two strings were not. The landing sold "the seconds your session is
 * open" — a clock that runs while you think, which is the fear this demo exists to kill — and the
 * console reported "Paused between runs" for a session that had in fact ended, settled and been
 * refunded. These assert the copy tells the same story the code does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const console_ = read("../src/web/console.tsx");
const landing = read("../public/index.html");
const consolePage = read("../public/console.html");

describe("FR-EXM-153 the pages say what the code does", () => {
  it("never tells the subscriber a session is paused, because none ever is", () => {
    // Only what reaches the screen: a comment may say why pause is gone, a status line may not.
    const shown = console_.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const paused = [...shown.matchAll(/^.*\bPaused?\b.*$/gim)].map((m) => m[0].trim());
    expect(paused, `${paused.join(" / ")} — the session ends with the run; nothing pauses`).toEqual([]);
  });

  it("does not bill the landing visitor for a session merely being open", () => {
    expect(landing, "the session ends with the run, so an open session is not what is billed").not.toMatch(
      /seconds? your session is open/i,
    );
  });

  it("bills for running code on both pages, in the same words", () => {
    for (const [name, page] of [["landing", landing], ["console", consolePage]] as const) {
      expect(page, `${name} should say the seconds are the ones the code runs`).toMatch(/seconds? (it|your code) runs/i);
    }
  });

  it("opens the console with an instruction, not a state readout", () => {
    const idle = console_.match(/const IDLE_STATUS = "([^"]+)"/)?.[1] ?? "";
    expect(idle, "the first line a subscriber reads should tell them what to do").toMatch(/Press Run/i);
  });
});
