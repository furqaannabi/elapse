/**
 * FR-RCT-020/021/022/031: <Meter> in the merchant's page. It ticks from rate × elapsed, follows the
 * server, shows the controls the start mode allows (each signature in the Elapse popup), and ends on
 * a receipt with the server's totals.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElapseProvider, Meter, type PopupHost } from "../src";

const NOW = 1_757_000_000_000;

type Sub = Record<string, unknown>;
const sub = (over: Sub = {}): Sub => ({
  id: "sub_1", object: "subscription", status: "active", product: "prod_1", customer: "cus_1", checkout_session: "cs_1",
  rate_usd_per_second: "0.004", started_at: (NOW - 83_450) / 1000, paused_at: null, canceled_at: null, ended_reason: null,
  max_duration_seconds: 3600, max_escrow_usd: "14.4", funded_usd: "14.4", settled_usd: "0", seconds_elapsed: 0,
  stream_address: "0x1", chain_id: 10143, currency: "ausd", livemode: false, created: NOW / 1000 - 90,
  start_mode: "checkout", start_by: null, subscriber_can_stop: true, ...over,
});
const wire = (subscription: Sub | null, product: Sub = {}) => ({
  id: "cs_1", object: "checkout.session", status: "complete", expires_at: NOW / 1000 + 86_400,
  merchant: { name: "Nimbus", logo_url: null, accent: null, support_url: null, success_url: "https://shop.test/ok", cancel_url: "https://shop.test/no" },
  product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: false, active: true, start_mode: "checkout", ...product },
  customer: { id: "cus_1", email: null }, subscription, max_duration_seconds: 3600, max_escrow_usd: "14.4", last_max_duration_seconds: null, restarted_as: null,
});

let server: ReturnType<typeof wire>;
function mount(initial: ReturnType<typeof wire>, props: Record<string, unknown> = {}) {
  server = initial;
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(server), { status: 200 }));
  const target = new EventTarget();
  const popup = { closed: false, close() { this.closed = true; } };
  const open = vi.fn(() => popup);
  const host: PopupHost = {
    open: open as unknown as PopupHost["open"],
    addEventListener: target.addEventListener.bind(target) as PopupHost["addEventListener"],
    removeEventListener: target.removeEventListener.bind(target) as PopupHost["removeEventListener"],
    screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 800,
  };
  const frame = () => document.querySelector("iframe.elapse-modal-frame") as HTMLIFrameElement | null;
  /** A result as the framed Elapse page sends it (FR-RCT-043). */
  const post = (data: Record<string, unknown>) => {
    const nonce = new URL(frame()!.src).searchParams.get("nonce");
    window.dispatchEvent(Object.assign(new Event("message"), { data: { type: "elapse:result", nonce, ...data }, origin: "https://elapse.finance", source: frame()!.contentWindow }));
  };
  const onStopped = vi.fn();
  render(
    <ElapseProvider publishableKey="pk_test_1" baseUrl="https://api.test" fetch={fetchFn as unknown as typeof fetch} popupHost={host} sound={false}>
      <Meter session="cs_1" onStopped={onStopped} {...props} />
    </ElapseProvider>,
  );
  return { fetchFn, open, post, frame, onStopped };
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("<Meter> · FR-RCT-020 the live meter", () => {
  it("FR_RCT_020_ticks_elapsed_and_accrued_from_the_rate", async () => {
    mount(wire(sub()));
    await settle();
    expect(screen.getByText("00:01:23")).toBeTruthy();
    expect(screen.getByText("$0.333")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText("00:01:33")).toBeTruthy();
  });

  it("FR_RCT_020_follows_the_server_to_the_receipt_within_5s", async () => {
    mount(wire(sub()));
    await settle();
    server = wire(sub({ status: "canceled", canceled_at: NOW / 1000, ended_reason: "canceled", seconds_elapsed: 83, settled_usd: "0.332" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(screen.getByText(/You paid for 83 seconds · \$0\.332/)).toBeTruthy();
    expect(screen.getByText("$14.068")).toBeTruthy(); // what came back: 14.4 − 0.332
  });
});

describe("<Meter> · FR-RCT-021 controls follow the start mode", () => {
  it("FR_RCT_021_checkout_mode_has_stop_and_pause_which_open_elapse", async () => {
    const { open, post, frame, onStopped } = mount(wire(sub(), { allow_pause: true }));
    await settle();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    // FR-RCT-043: in the frame on the merchant's page, not a window.
    expect(open).not.toHaveBeenCalled();
    const url = new URL(frame()!.src);
    expect(url.searchParams.get("action")).toBe("cancel");
    expect(url.searchParams.get("mode")).toBe("frame");
    await act(async () => { post({ step: "stopped", subscription: "sub_1", txHash: "0xabc" }); await vi.advanceTimersByTimeAsync(0); });
    expect(onStopped).toHaveBeenCalledWith({ subscription: "sub_1", txHash: "0xabc", explorerUrl: "https://testnet.monadscan.com/tx/0xabc" });
  });

  it("FR_RCT_021_a_started_merchant_mode_meter_has_no_stop_or_pause_and_says_who_stops_it", async () => {
    mount(wire(sub({ start_mode: "merchant", subscriber_can_stop: false }), { allow_pause: true, start_mode: "merchant" }));
    await settle();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getByText("Nimbus stops this meter. It ends by itself at your 1 hour.")).toBeTruthy();
  });

  it("FR_RCT_021_a_held_meter_waits_for_the_merchant_and_keeps_stop", async () => {
    mount(wire(sub({ status: "incomplete", started_at: null, start_mode: "merchant", start_by: NOW / 1000 + 600, funded_usd: "14.4" }), { start_mode: "merchant" }));
    await settle();
    expect(screen.getByText("Waiting for Nimbus to start")).toBeTruthy();
    expect(screen.getByText("$14.40 held · You haven’t been charged.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });
});

describe("<Meter> · FR-RCT-022 receipt", () => {
  it("FR_RCT_022_a_meter_that_never_started_has_no_start_time", async () => {
    mount(wire(sub({ status: "canceled", started_at: null, canceled_at: NOW / 1000, ended_reason: "canceled", seconds_elapsed: 0, settled_usd: "0" })));
    await settle();
    expect(screen.getByText(/You paid for 0 seconds · \$0\.00/)).toBeTruthy();
    expect(screen.queryByText("Started")).toBeNull();
  });
});

describe("<Meter dock> · FR-RCT-042 the docked capsule", () => {
  const capsule = () => document.querySelector(".elapse-dock");

  it("FR_RCT_042_docks_bottom_right_as_one_small_capsule", async () => {
    mount(wire(sub()), { dock: "bottom-right" });
    await settle();
    const el = capsule()!;
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-corner")).toBe("bottom-right");
    // The whole meter in one line: elapsed and amount, nothing else to read.
    expect(screen.getByText("00:01:23")).toBeTruthy();
    expect(screen.getByText("$0.333")).toBeTruthy();
    expect(screen.queryByText("GPU")).toBeNull();
    // A live region, because it is the only thing on screen that says what is being charged.
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.querySelector(".elapse-dot")).toBeTruthy();
  });

  it("FR_RCT_042_the_other_corner_is_a_value_not_another_component", async () => {
    mount(wire(sub()), { dock: "bottom-left" });
    await settle();
    expect(capsule()!.getAttribute("data-corner")).toBe("bottom-left");
  });

  it("FR_RCT_042_inline_stays_the_default_so_no_merchant_layout_moves", async () => {
    mount(wire(sub()));
    await settle();
    expect(capsule()).toBeNull();
    expect(screen.getByText("GPU", { exact: false })).toBeTruthy();
  });

  it("FR_RCT_042_the_dot_says_running_or_paused_without_a_word", async () => {
    mount(wire(sub()), { dock: "bottom-right" });
    await settle();
    expect(capsule()!.getAttribute("data-running")).toBe("true");
    server = wire(sub({ status: "paused", paused_at: NOW / 1000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(capsule()!.getAttribute("data-running")).toBe("false");
  });

  it("FR_RCT_042_a_merchant_started_meter_docks_without_controls", async () => {
    mount(wire(sub({ start_mode: "merchant", subscriber_can_stop: false }), { start_mode: "merchant" }), { dock: "bottom-right" });
    await settle();
    expect(capsule()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("FR_RCT_042_the_receipt_stays_in_the_corner_when_the_meter_ends", async () => {
    mount(wire(sub()), { dock: "bottom-right" });
    await settle();
    server = wire(sub({ status: "canceled", canceled_at: NOW / 1000, ended_reason: "canceled", seconds_elapsed: 83, settled_usd: "0.332" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(capsule()).toBeTruthy();
    expect(screen.getByText(/You paid for 83 seconds/)).toBeTruthy();
  });
});
