/**
 * FR-CHK-040 (amended, signed 2026-09-17): the hosted checkout is retired. Any /c/ link shows one
 * sentence and a way back to the merchant; no cap step, meter or wallet code.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutApiError, createMockCheckoutApi, type CheckoutApi } from "@/lib/checkout/mock-api";

let api: CheckoutApi;
vi.mock("@/lib/checkout/client", () => ({ getCheckoutApi: () => api }));

import { RetiredCheckout } from "./retired-checkout";

beforeEach(() => {
  api = createMockCheckoutApi({ latencyMs: 0, now: () => Date.now() });
});

describe("RetiredCheckout · FR-CHK-040", () => {
  it("FR_CHK_040_says_the_link_is_no_longer_used_and_returns_to_the_merchant", async () => {
    render(<RetiredCheckout sessionId="cs_ready" />);
    expect(screen.getByText("This checkout link is no longer used.")).toBeInTheDocument();
    const back = await screen.findByRole("link", { name: "Return to Nimbus" });
    expect(back.getAttribute("href")).toBe("https://nimbus.example/cancel");
    // None of the retired flow's controls (the shared frame has its own header button).
    expect(screen.queryByRole("button", { name: /start|authori[sz]e|stop|continue|face id/i })).toBeNull();
  });

  it("FR_CHK_040_an_unknown_session_still_shows_the_sentence", async () => {
    api = { ...api, getSession: async () => { throw new CheckoutApiError("not_found", "No such session"); } };
    render(<RetiredCheckout sessionId="cs_nope" />);
    expect(screen.getByText("This checkout link is no longer used.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
