/**
 * FR-CHK-034 on the page: a funded merchant-mode session the merchant has not started shows the
 * held view (never Start, never "already used"), Stop lands on a receipt for 0 seconds, and the
 * view follows the server into the meter when the merchant starts (FR-CHK-032 amendment).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCheckoutApi, type CheckoutApi } from "@/lib/checkout/mock-api";
import type { CheckoutSession } from "@/lib/checkout/types";

const now = 1_757_160_000_000;
let merchantStarted = false;
/** A fresh in-memory API per test: Stop in one test must not leave cs_held refunded for the next. */
function makeApi(): CheckoutApi {
  const inner = createMockCheckoutApi({ latencyMs: 0, now: () => now });
  return {
    ...inner,
    async getSession(id) {
      const s = await inner.getSession(id);
      if (!merchantStarted || !s.subscription || s.subscription.status === "canceled") return s;
      const { hold: _hold, ...rest } = s.subscription;
      const started: CheckoutSession = { ...s, subscription: { ...rest, status: "active", startedAt: now - 2_000 } };
      return started;
    },
  };
}
let api: CheckoutApi = makeApi();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/checkout/client", () => ({
  getCheckoutApi: () => api,
  usesRealApi: () => false,
}));

import { CheckoutPage } from "./checkout-page";

beforeEach(() => {
  merchantStarted = false;
  api = makeApi();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(now));
});
afterEach(() => vi.useRealTimers());

describe("CheckoutPage · FR-CHK-034 held session", () => {
  it("FR_CHK_034_a_held_session_shows_the_held_view_not_start_or_used", async () => {
    render(<CheckoutPage sessionId="cs_held" />);
    expect(await screen.findByRole("heading", { name: "Waiting for Nimbus to start" })).toBeInTheDocument();
    expect(screen.queryByText(/already been used/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^start/i })).toBeNull();
  });

  it("FR_CHK_034_stop_lands_on_a_receipt_for_zero_seconds_with_everything_back", async () => {
    render(<CheckoutPage sessionId="cs_held" />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getByText(/you paid for/i)).toBeInTheDocument());
    expect(screen.getByText(/0 seconds/)).toBeInTheDocument();
    expect(screen.getAllByText("$14.40").length).toBeGreaterThanOrEqual(1);
    // Never started, so there is no start time to show.
    expect(screen.queryByText("Started")).toBeNull();
  });

  it("FR_CHK_032_the_held_view_follows_the_server_into_the_meter_when_the_merchant_starts", async () => {
    render(<CheckoutPage sessionId="cs_held" />);
    expect(await screen.findByRole("heading", { name: "Waiting for Nimbus to start" })).toBeInTheDocument();
    merchantStarted = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_200);
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Waiting for Nimbus to start" })).toBeNull());
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
