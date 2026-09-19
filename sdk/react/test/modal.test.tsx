/**
 * FR-RCT-043/044: authorise happens in a modal frame on the merchant's page, and hands off to the
 * popup when Face ID cannot run in a frame — which is the ordinary path for a first-time
 * subscriber, since browsers block passkey enrolment cross-origin (ADR 2026-09-19).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Authorize, ElapseProvider, type PopupHost } from "../src";

const APP = "https://elapse.finance";
const session = {
  id: "cs_1", object: "checkout.session", status: "open", expires_at: 1_757_086_400,
  merchant: { name: "Nimbus", logo_url: null, accent: null, support_url: null, success_url: "https://shop.test/ok", cancel_url: "https://shop.test/no" },
  product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: false, active: true, start_mode: "merchant" },
  customer: null, subscription: null, max_duration_seconds: null, max_escrow_usd: null, last_max_duration_seconds: null, restarted_as: null,
};

function setup() {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(session), { status: 200 }));
  const target = new EventTarget();
  const popup = { closed: false, close() { this.closed = true; } };
  const open = vi.fn(() => popup);
  const host: PopupHost = {
    open: open as unknown as PopupHost["open"],
    addEventListener: target.addEventListener.bind(target) as PopupHost["addEventListener"],
    removeEventListener: target.removeEventListener.bind(target) as PopupHost["removeEventListener"],
    screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 800,
  };
  const onAuthorised = vi.fn();
  const onError = vi.fn();
  render(
    <ElapseProvider publishableKey="pk_test_1" baseUrl="https://api.test" appOrigin={APP} fetch={fetchFn as unknown as typeof fetch} popupHost={host} sound={false}>
      <Authorize session="cs_1" onAuthorised={onAuthorised} onError={onError} />
    </ElapseProvider>,
  );
  const frame = () => document.querySelector("iframe.elapse-modal-frame") as HTMLIFrameElement | null;
  /** A message as the framed page would send it: Elapse's origin, that frame's window. */
  const fromFrame = (data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(Object.assign(new Event("message"), { data, origin: APP, source: frame()!.contentWindow }));
    });
  const nonceOf = () => new URL(frame()!.src).searchParams.get("nonce")!;
  return { open, popup, target, frame, fromFrame, nonceOf, onAuthorised, onError };
}

const authorise = async () => {
  await screen.findByRole("button", { name: "Authorise" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Authorise" })); });
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("FR-RCT-043 the modal frame", () => {
  it("opens Elapse in a frame on the merchant's page, not a window", async () => {
    const { frame, open } = setup();
    await authorise();
    const el = frame()!;
    expect(el).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    const url = new URL(el.src);
    expect(url.origin).toBe(APP);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("session")).toBe("cs_1");
    expect(url.searchParams.get("action")).toBe("authorise");
    expect(url.searchParams.get("mode")).toBe("frame");
    // FR-CHK-038: the page resolves who may frame it from the session, using this key.
    expect(url.searchParams.get("pk")).toBe("pk_test_1");
    expect(url.searchParams.get("nonce")).toMatch(/^[0-9a-f]{32}$/);
    // Without this the frame cannot use an existing passkey at all.
    expect(el.getAttribute("allow")).toContain("publickey-credentials-get");
  });

  it("accepts a result from the frame, once, and only with the right nonce", async () => {
    const { fromFrame, nonceOf, onAuthorised } = setup();
    await authorise();
    await fromFrame({ type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: "not-the-nonce" });
    expect(onAuthorised).not.toHaveBeenCalled();
    await fromFrame({ type: "elapse:result", step: "authorised", subscription: "sub_1", txHash: "0xabc", nonce: nonceOf() });
    await waitFor(() => expect(onAuthorised).toHaveBeenCalledTimes(1));
  });

  it("hands off to a window when the framed page says Face ID cannot run there, keeping the nonce", async () => {
    const { fromFrame, nonceOf, frame, open, onAuthorised } = setup();
    await authorise();
    const nonce = nonceOf();
    await fromFrame({ type: "elapse:needs-window", nonce });
    // The frame is gone and the same attempt continues in a window.
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(frame()).toBeNull();
    expect(new URL((open.mock.calls[0] as unknown as [string])[0]).searchParams.get("nonce")).toBe(nonce);
    expect(onAuthorised).not.toHaveBeenCalled();
  });

  it("hands off when the frame does not load in time", async () => {
    const { open } = setup();
    await authorise();
    expect(open).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("a subscriber who asks for a window gets one", async () => {
    const { open, nonceOf } = setup();
    await authorise();
    const nonce = nonceOf();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Open a window/ })); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(new URL((open.mock.calls[0] as unknown as [string])[0]).searchParams.get("nonce")).toBe(nonce);
  });

  it("Escape closes it as a closed window does: back to the cap step, nothing charged, no error", async () => {
    const { frame, onError } = setup();
    await authorise();
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await waitFor(() => expect(frame()).toBeNull());
    expect(await screen.findByRole("button", { name: "Authorise" })).toBeTruthy();
    expect(screen.getByText("Nothing was charged.")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("FR-RCT-044 the modal is usable", () => {
  it("is a dialog with a name, takes focus, and gives it back", async () => {
    const { frame } = setup();
    const opener = await screen.findByRole("button", { name: "Authorise" });
    opener.focus();
    await act(async () => { fireEvent.click(opener); });

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await waitFor(() => expect(frame()).toBeNull());
    expect(document.body.style.overflow).not.toBe("hidden");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Authorise" })));
  });
});
