/** Worker loops must stop promptly on SIGTERM: a sleep ends early when the signal aborts. */
import { describe, expect, it } from "bun:test";
import { sleep } from "../src/worker/sleep";
import { cliExpiryForever } from "../src/services/cli-stream";

describe("abortable sleep", () => {
  it("resolves early when aborted", async () => {
    const c = new AbortController();
    const t0 = Date.now();
    setTimeout(() => c.abort(), 20);
    await sleep(60_000, c.signal);
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("resolves at once when already aborted, and normally when there is no signal", async () => {
    const c = new AbortController();
    c.abort();
    const t0 = Date.now();
    await sleep(60_000, c.signal);
    await sleep(5);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("cliExpiryForever", () => {
  it("returns within a moment of abort even with a one-minute cadence", async () => {
    const c = new AbortController();
    const done = cliExpiryForever(c.signal, undefined, 60_000);
    setTimeout(() => c.abort(), 30);
    const t0 = Date.now();
    await done;
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
