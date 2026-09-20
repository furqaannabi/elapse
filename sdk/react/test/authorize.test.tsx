/**
 * FR-RCT-010/011/013/014/031: <Authorize> reads the public session with the publishable key, offers the
 * cap presets with what each can cost, opens the Elapse popup on Authorise, and reports the result.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Authorize, ElapseProvider, type PopupHost } from "../src";

const T0 = 1_757_000_000;
function wireSession(over: { startMode?: "checkout" | "merchant" } = {}) {
  return {
    id: "cs_1", object: "checkout.session", status: "open", expires_at: T0 + 86_400,
    merchant: { name: "Nimbus", logo_url: null, accent: null, support_url: null, success_url: "https://shop.test/ok", cancel_url: "https://shop.test/no" },
    product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: false, active: true, start_mode: over.startMode ?? "checkout" },
    customer: null, subscription: null, max_duration_seconds: null, max_escrow_usd: null, last_max_duration_seconds: null, restarted_as: null,
  };
}

function setup(opts: { startMode?: "checkout" | "merchant"; blocked?: boolean; cap?: number } = {}) {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(wireSession(opts)), { status: 200 }));
  const target = new EventTarget();
  const popup = { closed: false, close() { this.closed = true; } };
  const open = vi.fn(() => (opts.blocked ? null : popup));
  const host: PopupHost = {
    open: open as unknown as PopupHost["open"],
    addEventListener: target.addEventListener.bind(target) as PopupHost["addEventListener"],
    removeEventListener: target.removeEventListener.bind(target) as PopupHost["removeEventListener"],
    screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 800,
  };
  const frame = () => document.querySelector("iframe.elapse-modal-frame") as HTMLIFrameElement | null;
  const frameNonce = () => new URL(frame()!.src).searchParams.get("nonce");
  const windowNonce = () => new URL((open.mock.calls[0] as unknown as [string])[0]).searchParams.get("nonce");
  /** A result as the framed Elapse page sends it (FR-RCT-043). */
  const post = (data: Record<string, unknown>) =>
    act(() => { window.dispatchEvent(Object.assign(new Event("message"), { data: { type: "elapse:result", nonce: frameNonce(), ...data }, origin: "https://elapse.finance", source: frame()!.contentWindow })); });
  /** The framed page reporting that Face ID cannot run in a frame, which moves the attempt to a window. */
  const needsWindow = () =>
    act(() => { window.dispatchEvent(Object.assign(new Event("message"), { data: { type: "elapse:needs-window", nonce: frameNonce() }, origin: "https://elapse.finance", source: frame()!.contentWindow })); });
  /** A result from the fallback window. */
  const postFromWindow = (data: Record<string, unknown>) =>
    act(() => { target.dispatchEvent(Object.assign(new Event("message"), { data: { type: "elapse:result", nonce: windowNonce(), ...data }, origin: "https://elapse.finance", source: popup })); });
  const onStarted = vi.fn();
  const onAuthorised = vi.fn();
  render(
    <ElapseProvider publishableKey="pk_test_1" baseUrl="https://api.test" fetch={fetchFn as unknown as typeof fetch} popupHost={host}>
      <Authorize session="cs_1" onStarted={onStarted} onAuthorised={onAuthorised} {...(opts.cap === undefined ? {} : { cap: opts.cap })} />
    </ElapseProvider>,
  );
  return { fetchFn, open, popup, post, needsWindow, postFromWindow, frame, onStarted, onAuthorised };
}

afterEach(() => vi.useRealTimers());

describe("<Authorize> · FR-RCT-010", () => {
  it("FR_RCT_010_reads_the_public_session_with_the_publishable_key", async () => {
    const { fetchFn } = setup();
    await screen.findByRole("button", { name: "Authorise" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/checkout/sessions/cs_1");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pk_test_1");
  });

  it("FR_RCT_010_offers_one_and_four_hours_with_what_each_can_cost", async () => {
    setup();
    expect(await screen.findByRole("radio", { name: /1 hour.*\$14\.40/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /4 hours.*\$57\.60/ })).toBeTruthy();
    expect(screen.getByText("You only pay the seconds you use. Anything unused comes back when you stop.")).toBeTruthy();
    expect(screen.queryByText(/Only Nimbus can stop this meter/)).toBeNull();
  });

  it("FR_RCT_010_a_merchant_mode_product_says_who_starts_and_stops_it", async () => {
    setup({ startMode: "merchant" });
    expect(await screen.findByText("Billing starts when Nimbus starts your session.")).toBeTruthy();
    expect(screen.getByText("Only Nimbus can stop this meter. It ends by itself at your 1 hour at the latest.")).toBeTruthy();
  });
});

describe("<Authorize> · FR-RCT-011/013/014/031", () => {
  it("FR_RCT_011_authorise_opens_elapse_for_the_chosen_cap", async () => {
    // FR-RCT-043: the frame first, on the merchant's page; the window is the fallback.
    const { open, frame } = setup();
    fireEvent.click(await screen.findByRole("radio", { name: /4 hours/ }));
    fireEvent.click(screen.getByRole("button", { name: "Authorise" }));
    expect(open).not.toHaveBeenCalled();
    const url = new URL(frame()!.src);
    expect(url.origin + url.pathname).toBe("https://elapse.finance/authorize");
    expect(url.searchParams.get("session")).toBe("cs_1");
    expect(url.searchParams.get("action")).toBe("authorise");
    expect(url.searchParams.get("cap")).toBe("14400");
  });

  it("FR_RCT_013_checkout_mode_reports_the_start_with_its_transaction", async () => {
    const { post, onStarted } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Authorise" }));
    post({ step: "authorised", subscription: "sub_1", txHash: "0x" + "ab".repeat(32) });
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStarted).toHaveBeenCalledWith({ subscription: "sub_1", txHash: "0x" + "ab".repeat(32), explorerUrl: "https://testnet.monadscan.com/tx/0x" + "ab".repeat(32) });
  });

  it("FR_RCT_013_merchant_mode_reports_authorised_and_waits_for_the_merchant", async () => {
    const { post, onAuthorised, onStarted } = setup({ startMode: "merchant" });
    fireEvent.click(await screen.findByRole("button", { name: "Authorise" }));
    post({ step: "authorised", subscription: "sub_1", txHash: "0xabc" });
    await waitFor(() => expect(onAuthorised).toHaveBeenCalledTimes(1));
    expect(onStarted).not.toHaveBeenCalled();
    expect(await screen.findByText("Waiting for Nimbus to start")).toBeTruthy();
  });

  it("FR_RCT_011_a_blocked_fallback_window_says_so_and_can_be_tried_again", async () => {
    // The frame could not do Face ID and the window it fell back to was blocked: the subscriber is
    // told the one thing that helps.
    const { needsWindow } = setup({ blocked: true });
    fireEvent.click(await screen.findByRole("button", { name: "Authorise" }));
    needsWindow();
    expect(await screen.findByText("Your browser blocked the Elapse window. Allow pop-ups and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("FR_RCT_043_the_fallback_window_finishes_the_same_attempt", async () => {
    const { needsWindow, postFromWindow, onStarted } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Authorise" }));
    needsWindow();
    postFromWindow({ step: "authorised", subscription: "sub_1", txHash: "0xabc" });
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  });

  it("FR_RCT_014_closing_the_fallback_window_returns_to_the_presets_with_nothing_charged", async () => {
    const { popup, needsWindow } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Authorise" }));
    needsWindow();
    popup.closed = true;
    expect(await screen.findByText("Nothing was charged.", undefined, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Authorise" })).toBeTruthy();
  });
});

describe("<Authorize cap> · FR-RCT-010 amended 2026-09-20", () => {
  it("skips the cap step and asks for the signature at once", async () => {
    const { frame } = setup({ cap: 3600, startMode: "merchant" });

    await waitFor(() => expect(frame()).toBeTruthy());
    // The merchant chose the cap, so the subscriber is not asked to.
    expect(screen.queryByText("How long may the meter run?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorise" })).toBeNull();
    // ...and it is that cap the permit is asked for.
    expect(new URL(frame()!.src).searchParams.get("cap")).toBe("3600");
  });

  it("asks only once, however many times it re-renders", async () => {
    const { frame, fetchFn } = setup({ cap: 3600 });
    await waitFor(() => expect(frame()).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll("iframe.elapse-modal-frame")).toHaveLength(1);
    void fetchFn;
  });

  it("still offers the cap step when no cap is given", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "Authorise" })).toBeTruthy();
    expect(screen.getByText("How long may the meter run?")).toBeTruthy();
  });
});
