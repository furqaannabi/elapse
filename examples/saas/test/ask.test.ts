import { describe, expect, it } from "vitest";
import { ask, clearWhen, type AskState } from "../src/web/ask";

const ok = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status }) as Response;

describe("FR-EXM-035 the waiting line is Acme's, not the SDK's", () => {
  it("says Acme was asked, then that Acme approved", async () => {
    const seen: AskState[] = [];
    await ask(ok(202, { status: "requested" }) as typeof fetch, "pause", "cs_9", (s) => seen.push(s));
    expect(seen).toEqual([
      { want: "pause", line: "Asked Acme to pause…" },
      { want: "pause", line: "Acme approved · pausing" },
    ]);
  });

  it("names Acme, not Elapse, when Acme refuses", async () => {
    const seen: AskState[] = [];
    await ask(ok(409, { error: "No running meter for that session." }) as typeof fetch, "pause", "cs_9", (s) => seen.push(s));
    expect(seen.at(-1)).toEqual({ want: null, line: "Acme could not pause that meter." });
  });

  it("does not leave the subscriber staring at a spinner when the network fails", async () => {
    const seen: AskState[] = [];
    await ask((() => Promise.reject(new Error("offline"))) as unknown as typeof fetch, "resume", "cs_9", (s) => seen.push(s));
    expect(seen.at(-1)?.want).toBe(null);
    expect(seen.at(-1)?.line).toMatch(/could not resume/i);
  });

  it("clears once the meter itself shows what was asked for, and not before", () => {
    // The meter re-reads every 5 s, so the line has to outlive the 202.
    expect(clearWhen({ want: "pause", line: "Acme approved · pausing" }, "running")).toBe(false);
    expect(clearWhen({ want: "pause", line: "Acme approved · pausing" }, "paused")).toBe(true);
    expect(clearWhen({ want: "resume", line: "Acme approved · resuming" }, "paused")).toBe(false);
    expect(clearWhen({ want: "resume", line: "Acme approved · resuming" }, "running")).toBe(true);
    // A refusal is not waiting for anything; it stays until the subscriber asks again.
    expect(clearWhen({ want: null, line: "Acme could not pause that meter." }, "paused")).toBe(false);
  });
});
