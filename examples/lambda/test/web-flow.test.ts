/**
 * FR-EXM-152 / FR-EXM-114: the console's brain, without a browser. Run → 409 → authorise in place
 * → resolve the subscription → auto-run. No navigation to a hosted page anywhere in here.
 */
import { describe, expect, it, vi } from "vitest";
import { postRun, readAccess, resolveSub, postClaim } from "../src/web/flow";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("FR-EXM-114 postRun", () => {
  it("asks the server to run inside the session it has", async () => {
    const fetchFn = vi.fn(async () => json(200, { ok: true, result: 4, ms: 3, logs: [] }));
    const out = await postRun(fetchFn as unknown as typeof fetch, "sub_1", "return 2+2");
    expect(out).toEqual({ k: "result", body: { ok: true, result: 4, ms: 3, logs: [] } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("./run?sub=sub_1");
    expect(JSON.parse(init.body as string)).toEqual({ code: "return 2+2" });
  });

  it("with no session yet, 409 hands back the checkout session to authorise in the page", async () => {
    const fetchFn = vi.fn(async () => json(409, { needs_start: true, session: "cs_7" }));
    const out = await postRun(fetchFn as unknown as typeof fetch, null, "return 1");
    expect(out).toEqual({ k: "needs_auth", session: "cs_7" });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("./run?sub=none");
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

/**
 * FR-EXM-111/154: what a poll of `/access` tells the console to do.
 *
 * William, 2026-09-21: "i ended a session from dashboard but i still see end session button on the
 * console despite it ended already". The console only left session state when `<Meter>` reported a
 * stop, so a meter cancelled anywhere else — the merchant's dashboard, the idle sweep, a `sk_` call
 * — left the page offering to end a session that was already settled. The server knew: the
 * `subscription.canceled` webhook had already closed it and `/access` was saying so on every tick.
 *
 * This is the second time this example has shipped a console that ignored its own `/access`; the
 * first was 2026-09-13, when the meter ticked forever after an auto-end. The decision is a pure
 * function this time so it has a regression seam that does not need a browser (BR-EXM-104 rules
 * Playwright out).
 */
describe("FR-EXM-111 readAccess", () => {
  it("says the session is over however it ended, so the page stops offering to end it", () => {
    expect(readAccess({ active: false, reason: "ended" })).toBe("ended");
  });

  it("distinguishes a paused meter from an ended one", () => {
    // A paused session still has escrow and an authorisation behind it; treating it as ended would
    // send the subscriber off to authorise a second session they already have.
    expect(readAccess({ active: false, reason: "paused" })).toBe("paused");
    expect(readAccess({ active: true, reason: "running" })).toBe("running");
  });

  it("ignores an answer it cannot read rather than guessing the session away", () => {
    // A failed poll, a restarting server, or a state this build does not know about must never
    // close a running session: the cost of a wrong "ended" is a subscriber who thinks they stopped
    // paying and has not.
    for (const body of [null, {}, { reason: "authorised" }, { reason: "starting" }, { reason: "unknown session" }]) {
      expect(readAccess(body)).toBe("ignore");
    }
  });
});

describe("FR-EXM-157 the console claims its subscription", () => {
  it("tells the console the session is ready when Northwind adopts the claim", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ state: "authorised" }), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await postClaim(fetchFn, "sub_1")).toEqual({ k: "ready" });
    expect(calls).toEqual(["POST ./claim?sub=sub_1"]);
  });

  it("passes the platform's refusal through, so the subscriber is not asked to authorise again", async () => {
    // The whole point: a claim that cannot be verified must not look like "no session yet", or the
    // console renders <Authorize> and the subscriber pays into a second escrow.
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "Northwind can't reach Elapse to confirm your session." }), {
        status: 503,
      })) as unknown as typeof fetch;

    expect(await postClaim(fetchFn, "sub_1")).toEqual({
      k: "refused",
      message: "Northwind can't reach Elapse to confirm your session.",
    });
  });

  it("asks for a fresh session only when Northwind says this one is spent", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ needs_start: true }), { status: 409 })) as unknown as typeof fetch;
    expect(await postClaim(fetchFn, "sub_1")).toEqual({ k: "needs_auth" });
  });
});
