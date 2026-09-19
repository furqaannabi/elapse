/**
 * FR-CHK-038: only the merchant that owns the session may frame `/authorize`. Anything else — a
 * guessed key, a session that is not theirs, an API that does not answer — gets `frame-ancestors
 * 'none'`, which leaves the window path working and the page unframable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const session = (successUrl: string) => ({ merchant: { success_url: successUrl } });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const run = (query: string) => middleware(new NextRequest(`https://elapse.finance/authorize${query}`));
const csp = async (query: string) => (await run(query)).headers.get("content-security-policy");

beforeEach(() => vi.restoreAllMocks());

describe("frame-ancestors on /authorize", () => {
  it("allows the origin of the session's success_url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(session("https://shop.test/ok"))));
    expect(await csp("?mode=frame&session=cs_1&pk=pk_test_abc")).toBe("frame-ancestors https://shop.test");
  });

  it("allows a developer's localhost, since test sessions live there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(session("http://localhost:3000/console"))));
    expect(await csp("?mode=frame&session=cs_1&pk=pk_test_abc")).toBe("frame-ancestors http://localhost:3000");
  });

  it("refuses plain http anywhere else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(session("http://shop.test/ok"))));
    expect(await csp("?mode=frame&session=cs_1&pk=pk_test_abc")).toBe("frame-ancestors 'none'");
  });

  it("frames nothing when the page was not asked for as a frame", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect(await csp("?session=cs_1&nonce=n1")).toBe("frame-ancestors 'none'");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a malformed session or key without asking the API", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect(await csp("?mode=frame&session=../evil&pk=pk_test_abc")).toBe("frame-ancestors 'none'");
    expect(await csp("?mode=frame&session=cs_1&pk=sk_test_abc")).toBe("frame-ancestors 'none'");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses when the API says no, or says nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect(await csp("?mode=frame&session=cs_1&pk=pk_test_abc")).toBe("frame-ancestors 'none'");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await csp("?mode=frame&session=cs_1&pk=pk_test_abc")).toBe("frame-ancestors 'none'");
  });
});
