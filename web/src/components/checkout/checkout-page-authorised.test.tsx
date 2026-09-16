/**
 * FR-CHK-033: after authorising a merchant-mode session the subscriber is not shown a meter. The
 * page says it is taking them back, re-reads the session every 2 s, and leaves for the merchant's
 * success URL once the funding has confirmed (the session is `complete`). If that takes longer
 * than 20 s it stops waiting and offers the button instead.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCheckoutApi, type CheckoutApi } from "@/lib/checkout/mock-api";
import type { CheckoutSession } from "@/lib/checkout/types";

const now = 1_757_160_000_000;
let funded = false;
const leaveTo = vi.fn();

function makeApi(): CheckoutApi {
  const inner = createMockCheckoutApi({ latencyMs: 0, now: () => now });
  const merchantMode = async (): Promise<CheckoutSession> => {
    const s = await inner.getSession("cs_ready");
    const sub = { ...s.subscription!, startMode: "merchant" as const };
    return funded
      ? { ...s, status: "complete", subscription: { ...sub, hold: { startBy: now + 600_000, heldUsd: sub.fundedUsd } } }
      : { ...s, subscription: sub };
  };
  return { ...inner, getSession: merchantMode, start: merchantMode };
}
let api: CheckoutApi = makeApi();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/checkout/client", () => ({ getCheckoutApi: () => api, usesRealApi: () => false }));
vi.mock("@/lib/checkout/navigate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/checkout/navigate")>()),
  leaveTo: (url: string) => leaveTo(url),
}));

import { CheckoutPage } from "./checkout-page";

beforeEach(() => {
  funded = false;
  leaveTo.mockClear();
  api = makeApi();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(now));
});
afterEach(() => vi.useRealTimers());

async function authorise() {
  render(<CheckoutPage sessionId="cs_ready" />);
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  expect(await screen.findByText("Authorised — taking you back to Nimbus")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
}

describe("CheckoutPage · FR-CHK-033 back to the merchant after authorising", () => {
  it("FR_CHK_033_leaves_for_the_success_url_once_the_funding_confirms", async () => {
    await authorise();
    expect(leaveTo).not.toHaveBeenCalled();
    funded = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_200);
    });
    expect(leaveTo).toHaveBeenCalledTimes(1);
    expect(leaveTo.mock.calls[0]![0]).toMatch(/session_id=cs_ready$/);
  });

  it("FR_CHK_033_after_20s_without_confirmation_it_offers_the_button_and_does_not_leave", async () => {
    await authorise();
    expect(screen.queryByRole("link", { name: /Back to Nimbus/ })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_500);
    });
    const back = await screen.findByRole("link", { name: /Back to Nimbus/ });
    expect(back.getAttribute("href")).toMatch(/session_id=cs_ready$/);
    expect(leaveTo).not.toHaveBeenCalled();
  });
});
