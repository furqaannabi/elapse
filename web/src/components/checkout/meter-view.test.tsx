/**
 * The running meter: what it costs, how much of the cap is left, and one
 * way to stop. Nothing here offers more funds — the cap is the session.
 *
 * FR-CHK-005 (meter view), FR-CHK-006 (low balance names the cap),
 * FR-CHK-007 (no out-of-funds pause), BR-CHK-004 (no red).
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product, Subscription } from "@/lib/checkout/types";
import { MeterView } from "./meter-view";

const NOW = 1_756_800_000_000;
const product: Product = {
  id: "prod_gpu",
  name: "GPU · 4090",
  rateUsdPerSecond: "0.004",
  allowPause: false,
  status: "active",
};
// A 1-hour cap at $0.004/s is $14.40.
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "sub_test",
  status: "active",
  startedAt: NOW - 83_000,
  pausedAt: null,
  canceledAt: null,
  maxDurationSeconds: 3600,
  fundedUsd: "14.4",
  rateUsdPerSecond: "0.004",
  ...over,
});

const props = {
  product,
  successHref: "https://nimbus.example/ok?session_id=cs_1",
  merchantName: "Nimbus",
  onCancel: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
};

describe("MeterView", () => {
  it("shows the cap and how much of it is left", () => {
    render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(screen.getByText(/of your 1 hour/i)).toBeInTheDocument();
  });

  it("names the cap in the low-balance notice and offers no way to add funds", () => {
    vi.setSystemTime(new Date(NOW));
    render(
      <MeterView {...props} subscription={sub({ startedAt: NOW - 3_400_000 })} view="low_balance" />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/left of your 1 hour/i);
    expect(screen.queryByRole("button", { name: /add funds/i })).toBeNull();
    vi.useRealTimers();
  });

  it("never says out of funds and never offers a resume for money", () => {
    const { container } = render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(container.textContent).not.toMatch(/out of funds|add funds/i);
  });

  it("returns to the merchant with the meter still running (FR-CHK-005, FR-CHK-009)", () => {
    render(<MeterView {...props} subscription={sub()} view="running" />);
    const back = screen.getByRole("link", { name: /back to nimbus/i });
    expect(back).toHaveAttribute("href", "https://nimbus.example/ok?session_id=cs_1");
    expect(screen.getByText(/your meter keeps running/i)).toBeInTheDocument();
  });

  it("links to the account page from a running meter (FR-CHK-017)", () => {
    render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(screen.getByRole("link", { name: /your meters/i })).toHaveAttribute("href", "/account");
  });

  it("offers Stop (never the word Cancel, FR-CHK-005), and Pause only when the product allows it", () => {
    const { rerender } = render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    rerender(
      <MeterView
        {...props}
        product={{ ...product, allowPause: true }}
        subscription={sub()}
        view="running"
      />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("FR_CHK_030_paused_shows_a_frozen_readout_Resume_and_Stop_and_the_paused_copy_with_no_chain_words", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_757_160_000_000));
    const startedAt = 1_757_160_000_000 - 83_000;
    const pausedAt = 1_757_160_000_000 - 10_000;
    render(<MeterView {...props} product={{ ...product, allowPause: true }} subscription={{ ...sub(), status: "paused", startedAt, pausedAt }} view="paused" />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(/nothing is charged while paused/i)).toBeInTheDocument();
    // 73 s elapsed at the pause instant, frozen since (rate 0.004 → $0.292).
    const before = screen.getByText(/\$0\.292/).textContent;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/\$0\.292/).textContent).toBe(before);
    expect(document.body.textContent).not.toMatch(/wallet|transaction|signature|chain/i);
    vi.useRealTimers();
  });
});

describe("MeterView · FR-CHK-037 the merchant stops a merchant-mode meter", () => {
  it("FR_CHK_037_a_started_merchant_mode_meter_has_no_stop_or_pause_and_says_who_stops_it", () => {
    render(
      <MeterView
        {...props}
        product={{ ...product, allowPause: true }}
        subscription={sub({ startMode: "merchant", subscriberCanStop: false })}
        view="running"
      />,
    );
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pause/i })).toBeNull();
    expect(screen.getByText("Nimbus stops this meter. It ends by itself at your 1 hour.")).toBeInTheDocument();
    // The usual "Stop it here" reassurance would now be false.
    expect(screen.queryByText(/stop it here/i)).toBeNull();
  });

  it("FR_CHK_037_a_checkout_mode_meter_keeps_stop", () => {
    render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
  });
});
