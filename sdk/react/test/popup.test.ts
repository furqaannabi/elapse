/**
 * FR-RCT-011/012/014, BR-RCT-003/004: the signing popup. The page opens it synchronously, then
 * trusts exactly one message: from the Elapse origin, from that popup, carrying this attempt's nonce.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignature, type PopupHost } from "../src/popup";

const APP = "https://elapse.finance";

/** A fake browser window: an event target that can open a fake popup. */
function fakeHost(opts: { blocked?: boolean } = {}) {
  const target = new EventTarget();
  const popup = { closed: false, close() { this.closed = true; } };
  const open = vi.fn(() => (opts.blocked ? null : popup));
  const host: PopupHost = {
    open: open as unknown as PopupHost["open"],
    addEventListener: target.addEventListener.bind(target) as PopupHost["addEventListener"],
    removeEventListener: target.removeEventListener.bind(target) as PopupHost["removeEventListener"],
    screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 800,
  };
  const post = (data: unknown, over: { origin?: string; source?: unknown } = {}) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data, origin: over.origin ?? APP, source: "source" in over ? over.source : popup }));
  return { host, popup, open, post };
}

afterEach(() => vi.useRealTimers());

describe("requestSignature · FR-RCT-011/012", () => {
  it("FR_RCT_011_opens_the_elapse_popup_with_the_session_action_cap_and_a_fresh_nonce", () => {
    const { host, open } = fakeHost();
    requestSignature({ host, appOrigin: APP, session: "cs_1", action: "authorise", capSeconds: 3600, nonce: "n1" });
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0] as unknown as [string, string, string];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${APP}/authorize`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ session: "cs_1", action: "authorise", cap: "3600", nonce: "n1" });
    expect(name).toBe("elapse-authorize");
    expect(features).toMatch(/width=480,height=720/);
  });

  it("FR_RCT_012_resolves_with_the_result_the_popup_posts", async () => {
    const { host, post } = fakeHost();
    const { result } = requestSignature({ host, appOrigin: APP, session: "cs_1", action: "authorise", capSeconds: 3600, nonce: "n1" });
    post({ type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: "n1" });
    await expect(result).resolves.toEqual({ step: "authorised", subscription: "sub_1", txHash: "0xabc" });
  });

  it("FR_RCT_012_ignores_a_message_from_another_origin_another_window_or_another_attempt", async () => {
    vi.useFakeTimers();
    const { host, popup, post } = fakeHost();
    const { result } = requestSignature({ host, appOrigin: APP, session: "cs_1", action: "cancel", nonce: "n1" });
    const ok = { type: "elapse:result", step: "stopped", subscription: "sub_1", txHash: "0xabc", nonce: "n1" };
    let settled = false;
    result.then(() => (settled = true), () => (settled = true));

    post(ok, { origin: "https://evil.example" });
    post(ok, { source: {} });
    post({ ...ok, nonce: "n2" });
    post({ ...ok, step: "drained" });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    popup.closed = false;
    post(ok);
    await expect(result).resolves.toEqual({ step: "stopped", subscription: "sub_1", txHash: "0xabc" });
  });

  it("BR_RCT_004_keeps_only_the_step_subscription_and_hash_from_the_message", async () => {
    const { host, post } = fakeHost();
    const { result } = requestSignature({ host, appOrigin: APP, session: "cs_1", action: "pause", nonce: "n1" });
    post({ type: "elapse:result", step: "paused", subscription: "sub_1", txHash: "0xabc", nonce: "n1", signature: "0xdead", token: "privy" });
    const r = await result;
    expect(Object.keys(r).sort()).toEqual(["step", "subscription", "txHash"]);
  });
});

describe("requestSignature · FR-RCT-011/014 when no signature comes back", () => {
  it("FR_RCT_011_a_blocked_popup_rejects_with_the_sentence_to_show", async () => {
    const { host } = fakeHost({ blocked: true });
    const { result } = requestSignature({ host, appOrigin: APP, session: "cs_1", action: "authorise", capSeconds: 3600 });
    await expect(result).rejects.toMatchObject({ reason: "blocked", message: "Your browser blocked the Elapse window. Allow pop-ups and try again." });
  });

  it("FR_RCT_014_closing_the_popup_rejects_as_closed_and_stops_listening", async () => {
    vi.useFakeTimers();
    const { host, popup, post } = fakeHost();
    const { result } = requestSignature({ host, appOrigin: APP, session: "cs_1", action: "authorise", capSeconds: 3600, nonce: "n1", closedPollMs: 500 });
    const rejected = expect(result).rejects.toMatchObject({ reason: "closed", message: "Nothing was charged." });
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(600);
    await rejected;
    // A late message after the window closed changes nothing.
    post({ type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: "n1" });
  });
});

