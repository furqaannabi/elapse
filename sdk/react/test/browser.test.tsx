/**
 * FR-RCT-001 (ADR 2026-09-18 CDN mount API): `mount()` is the whole surface for a page with no
 * bundler — one element, one call, React bundled in. Same flow the components give a React app:
 * the cap step, then the meter.
 */
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "../src/browser";

const T0 = 1_757_000_000;
const session = {
  id: "cs_1", object: "checkout.session", status: "open", expires_at: T0 + 86_400,
  merchant: { name: "Nimbus", logo_url: null, accent: null, support_url: null, success_url: "https://shop.test/ok", cancel_url: "https://shop.test/no" },
  product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: false, active: true, start_mode: "checkout" },
  customer: null, subscription: null, max_duration_seconds: null, max_escrow_usd: null, last_max_duration_seconds: null, restarted_as: null,
};

function host() {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

const fetchFn = () => vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })) as unknown as typeof fetch;

afterEach(() => { document.body.innerHTML = ""; });

describe("FR-RCT-001 mount", () => {
  it("renders the cap step into the element it is given", async () => {
    mount(host(), { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    expect(await screen.findByText("How long may the meter run?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Authorise" })).toBeDefined();
  });

  it("refuses a secret key, in the browser of all places", () => {
    expect(() => mount(host(), { publishableKey: "sk_test_1", session: "cs_1" })).toThrow(/Never put a secret key in the browser/);
  });

  it("takes an element or a CSS selector", async () => {
    const el = host();
    el.id = "elapse-here";
    mount("#elapse-here", { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    expect(await screen.findByText("How long may the meter run?")).toBeDefined();
  });

  it("says which element it could not find", () => {
    expect(() => mount("#nope", { publishableKey: "pk_test_1", session: "cs_1" })).toThrow(/#nope/);
  });

  it("unmounts, by the returned handle or by the element", async () => {
    const a = host();
    const off = mount(a, { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    await screen.findByText("How long may the meter run?");
    off();
    await waitFor(() => expect(a.innerHTML).toBe(""));

    const b = host();
    mount(b, { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    await screen.findByText("How long may the meter run?");
    unmount(b);
    await waitFor(() => expect(b.innerHTML).toBe(""));
  });

  it("mounting twice on one element replaces the first, it does not stack", async () => {
    const el = host();
    mount(el, { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    mount(el, { publishableKey: "pk_test_1", session: "cs_1", baseUrl: "https://api.test", fetch: fetchFn() });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Authorise" })).toHaveLength(1));
  });
});
