import { describe, expect, it } from "vitest";

// The deployed Lambda is plain .mjs so it can be zipped and shipped as-is;
// runner/index.d.mts carries its contract for typechecking.
import { handler } from "../runner/index.mjs";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("FR-EXM-122 the runner executes submitted JavaScript", () => {
  it("returns the value the code returns", async () => {
    const r = await handler({ code: "return 2 + 2" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toBe(4);
    expect(typeof r.ms).toBe("number");
  });

  it("captures console.log", async () => {
    const r = await handler({ code: "console.log('hello'); return null" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.logs).toContain("hello");
  });

  it("reports a thrown error readably instead of crashing", async () => {
    const r = await handler({ code: "throw new Error('boom')" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected a failure");
    expect(r.error).toMatch(/boom/);
  });

  it("serialises undefined as null", async () => {
    const r = await handler({ code: "const x = 1;" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toBeNull();
  });

  it("runs the default snippet the console opens on, shortened so the suite does not wait", async () => {
    // FR-EXM-122 amended 2026-09-21: the console opens on 30 real seconds. The snippet takes the
    // count so this runs one second instead of thirty; the shipped default is asserted below.
    const { defaultSnippet } = (await import("../runner/snippet.mjs")) as unknown as { defaultSnippet: (s?: number) => string };
    const started = Date.now();
    const r = await handler({ code: defaultSnippet(1) });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    // It burns a real second of CPU rather than sleeping: that is what the meter is billing for.
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(r.result).toMatchObject({ seconds: 1 });
    expect((r.result as { rounds: number }).rounds).toBeGreaterThan(0);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toMatch(/^\s*1s · [\d,]+ rounds$/);
  });

  it("ships a default that runs for thirty seconds, so the meter is legible", async () => {
    const m = (await import("../runner/snippet.mjs")) as unknown as { DEFAULT_SNIPPET: string; defaultSnippet: (s?: number) => string };
    expect(m.DEFAULT_SNIPPET).toBe(m.defaultSnippet());
    expect(m.DEFAULT_SNIPPET).toContain("SECONDS = 30");
  });

  it("runs the heavier Mandelbrot example to a real PNG", async () => {
    const { MANDELBROT_SNIPPET } = (await import("../runner/snippet.mjs")) as unknown as { MANDELBROT_SNIPPET: string };
    const r = await handler({ code: MANDELBROT_SNIPPET });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(String(r.result)).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(String(r.result).split(",")[1] ?? "", "base64");
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC);
  });

});

describe("FR-EXM-122 general-purpose JavaScript", () => {
  it("has fetch available (network calls are a wanted capability, not an accident)", async () => {
    const r = await handler({ code: "return typeof fetch" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toBe("function");
  });

  it("sorts, maps and does ordinary JS", async () => {
    const r = await handler({ code: "return [3,1,2].sort((a,b)=>a-b).map(n => n * 10)" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toEqual([10, 20, 30]);
  });

  it("awaits promises", async () => {
    const r = await handler({ code: "const v = await Promise.resolve(21); return v * 2" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.result).toBe(42);
  });

  it("can use node builtins via require (works in vitest, node and Lambda alike)", async () => {
    const r = await handler({ code: "const { createHash } = require('node:crypto'); return createHash('sha256').update('elapse').digest('hex').slice(0, 8)" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(String(r.result)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("FR-EXM-122 the default snippet runs on any build of the runner", () => {
  it("needs nothing but console and return, so it works on the deployed runner too", async () => {
    // The runner deployed to AWS predates `require` support: it passes only `console` to
    // new Function. A default that reaches for node:crypto dies there with "require is not
    // defined" — which is exactly what happened. The default must stay portable.
    const { defaultSnippet } = (await import("../runner/snippet.mjs")) as unknown as { defaultSnippet: (s?: number) => string };
    const logs: string[] = [];
    const bare = new Function("console", `"use strict"; return (async () => { ${defaultSnippet(1)} })();`);
    const result = await bare({ log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) });
    expect(result).toMatchObject({ seconds: 1 });
    expect(logs).toHaveLength(1);
  });
});
