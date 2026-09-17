/**
 * FR-CHK-037 on /account: a merchant-mode meter the merchant has started has no Stop or Pause.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountMeter } from "@/lib/account/types";
import { MeterRow } from "./meter-row";

const meter = (over: Partial<AccountMeter> = {}): AccountMeter => ({
  subscription: "sub_m",
  merchant: { name: "Northwind Compute" },
  product: { name: "Serverless runtime", rateUsdPerSecond: "0.002" },
  status: "active",
  allowPause: true,
  startedAt: Date.now() - 60_000,
  pausedAt: null,
  maxDurationSeconds: 3600,
  fundedUsd: "7.2",
  ...over,
});

describe("MeterRow · FR-CHK-037", () => {
  it("FR_CHK_037_a_merchant_controlled_meter_has_no_stop_or_pause", () => {
    render(<MeterRow meter={meter({ merchantControlled: true })} onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /stop this meter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /pause this meter/i })).toBeNull();
    expect(screen.getByText("Northwind Compute stops this meter")).toBeInTheDocument();
  });

  it("FR_CHK_037_an_ordinary_meter_keeps_stop_and_pause", () => {
    render(<MeterRow meter={meter()} onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(screen.getByRole("button", { name: /stop this meter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause this meter/i })).toBeInTheDocument();
  });
});
