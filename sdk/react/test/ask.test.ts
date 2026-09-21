import { describe, expect, it } from "vitest";
import { ask, clearWhen, type AskState } from "../src/ask";

const MERCHANT = "Acme GPU";

describe("FR-RCT-046 the meter says what the merchant is doing about the request", () => {
  it("names the merchant while waiting, then when they agree", async () => {
    const seen: AskState[] = [];
    await ask("pause", MERCHANT, async () => {}, (s) => seen.push(s));
    expect(seen).toEqual([
      { want: "pause", pending: true, line: "Asked Acme GPU to pause…" },
      { want: "pause", pending: false, line: "Acme GPU approved · pausing" },
    ]);
  });

  it("blames the merchant, never Elapse and never the chain, when the ask fails", async () => {
    const seen: AskState[] = [];
    await ask("pause", MERCHANT, async () => { throw new Error("relayer_unfunded"); }, (s) => seen.push(s));
    expect(seen.at(-1)).toEqual({ want: null, pending: false, line: "Acme GPU could not pause that meter." });
    // BR-RCT-001: the merchant's own word for it reaches the subscriber, the platform's does not.
    expect(JSON.stringify(seen)).not.toMatch(/relayer|elapse|chain|tx/i);
  });

  it("treats a handler that returns nothing as agreed at once", async () => {
    const seen: AskState[] = [];
    await ask("resume", MERCHANT, () => {}, (s) => seen.push(s));
    expect(seen.map((s) => s.pending)).toEqual([true, false]);
    expect(seen.at(-1)?.line).toBe("Acme GPU approved · resuming");
  });

  it("holds the approval until the meter itself changes, since that is 5 s away", () => {
    const approved: AskState = { want: "pause", pending: false, line: "Acme GPU approved · pausing" };
    expect(clearWhen(approved, "running")).toBe(false);
    expect(clearWhen(approved, "paused")).toBe(true);
    const resuming: AskState = { want: "resume", pending: false, line: "Acme GPU approved · resuming" };
    expect(clearWhen(resuming, "paused")).toBe(false);
    expect(clearWhen(resuming, "running")).toBe(true);
    // A refusal waits for nothing; it stands until the subscriber asks again.
    expect(clearWhen({ want: null, pending: false, line: "Acme GPU could not pause that meter." }, "paused")).toBe(false);
  });
});
