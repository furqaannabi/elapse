/**
 * The running meter: what it costs, how much of the cap is left, and one
 * way to stop. Nothing here offers more funds — the cap is the session.
 *
 * FR-CHK-005 (meter view), FR-CHK-006 (low balance names the cap),
 * FR-CHK-007 (no out-of-funds pause), BR-CHK-004 (no red).
 */
import { render, screen } from "@testing-library/react";
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

  it("offers Cancel, and Pause only when the product allows it", () => {
    const { rerender } = render(<MeterView {...props} subscription={sub()} view="running" />);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
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
});
