/**
 * FR-EXM-152 / FR-EXM-114: the console's brain, without a browser. Run → 409 → authorise in place
 * → resolve the subscription → auto-run. No navigation to a hosted page anywhere in here.
 */
import { describe, expect, it, vi } from "vitest";
import { postRun, resolveSub } from "../src/web/flow";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FR-EXM-114 postRun", () => {
  it("asks the server to run inside the session it has", async () => {
    const fetchFn = vi.fn(async () => json(200, { ok: true, result: 4, ms: 3, logs: [] }));
    const out = await postRun(fetchFn as unknown as typeof fetch, "sub_1", "return 2+2");
    expect(out).toEqual({ k: "result", body: { ok: true, result: 4, ms: 3, logs: [] } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/run?sub=sub_1");
    expect(JSON.parse(init.body as string)).toEqual({ code: "return 2+2" });
  });

  it("with no session yet, 409 hands back the checkout session to authorise in the page", async () => {
    const fetchFn = vi.fn(async () => json(409, { needs_start: true, session: "cs_7" }));
    const out = await postRun(fetchFn as unknown as typeof fetch, null, "return 1");
    expect(out).toEqual({ k: "needs_auth", session: "cs_7" });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/run?sub=none");
  });

  it("passes the server's own sentence through on a refusal", async () => {
    const fetchFn = vi.fn(async () => json(503, { error: "The meter didn't start, so nothing ran and nothing was charged." }));
    expect(await postRun(fetchFn as unknown as typeof fetch, "sub_1", "x")).toEqual({
      k: "error",
      message: "The meter didn't start, so nothing ran and nothing was charged.",
    });
  });

  it("a network failure is an error, not an exception the page has to catch", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("offline"); });
    expect(await postRun(fetchFn as unknown as typeof fetch, "sub_1", "x")).toEqual({ k: "error", message: "offline" });
  });
});

describe("FR-EXM-114 resolveSub", () => {
  it("waits for the completed webhook to link the checkout session to its subscription", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => (++calls < 3 ? json(404, { error: "not found" }) : json(200, { sub: "sub_9" })));
    const sleep = vi.fn(async () => {});
    expect(await resolveSub(fetchFn as unknown as typeof fetch, "cs_7", { attempts: 5, sleep })).toBe("sub_9");
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after its attempts rather than spinning forever", async () => {
    const fetchFn = vi.fn(async () => json(404, { error: "not found" }));
    expect(await resolveSub(fetchFn as unknown as typeof fetch, "cs_7", { attempts: 3, sleep: async () => {} })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
