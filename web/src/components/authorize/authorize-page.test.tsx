/**
 * FR-CHK-038/039: the Elapse popup. It signs one action for the merchant's page, posts the result to
 * the session's success-URL origin, and closes; without an opener it says the window can be closed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutApiError, createMockCheckoutApi, type CheckoutApi } from "@/lib/checkout/mock-api";

let api: CheckoutApi;
vi.mock("@/lib/checkout/client", () => ({ getCheckoutApi: () => api, usesRealApi: () => false }));

import { AuthorizePage } from "./authorize-page";

beforeEach(() => {
  api = createMockCheckoutApi({ latencyMs: 0, now: () => Date.now() });
});

describe("AuthorizePage · FR-CHK-038/039", () => {
  it("FR_CHK_038_authorise_confirms_the_amount_posts_the_result_to_the_merchant_and_closes", async () => {
    const opener = { postMessage: vi.fn() };
    const close = vi.fn();
    render(<AuthorizePage session="cs_ready" action="authorise" cap="3600" nonce="n1" opener={opener} close={close} />);
    expect(await screen.findByRole("heading", { name: "Authorise up to $14.40 for Nimbus" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("Done. Returning you to Nimbus.")).toBeInTheDocument();
    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    const [message, target] = opener.postMessage.mock.calls[0]!;
    expect(target).toBe("https://nimbus.example");
    expect(message).toMatchObject({ type: "elapse:result", step: "authorised", nonce: "n1" });
    expect(message.subscription).toMatch(/^sub_/);
    expect(message.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("FR_CHK_038_without_an_opener_it_says_the_window_can_be_closed", async () => {
    const close = vi.fn();
    render(<AuthorizePage session="cs_ready" action="authorise" cap="3600" nonce="n1" opener={null} close={close} />);
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("You can close this window.")).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });

  it("FR_CHK_039_stop_asks_about_the_merchant_and_posts_stopped", async () => {
    const opener = { postMessage: vi.fn() };
    render(<AuthorizePage session="cs_running" action="cancel" nonce="n2" opener={opener} close={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Stop your meter at Nimbus?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalled());
    expect(opener.postMessage.mock.calls[0]![0]).toMatchObject({ step: "stopped", nonce: "n2" });
  });

  it("FR_CHK_039_a_signed_out_subscriber_is_asked_to_sign_in_first", async () => {
    render(<AuthorizePage session="cs_demo" action="authorise" cap="3600" nonce="n1" opener={null} close={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /continue with face id/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("FR_CHK_039_a_failed_submit_shows_the_apis_sentence_and_can_be_tried_again", async () => {
    const inner = api;
    let fail = true;
    api = { ...inner, submit: async (id, action) => {
      if (fail) { fail = false; throw new CheckoutApiError("invalid_state", "This meter is already running."); }
      return inner.submit(id, action);
    } };
    const opener = { postMessage: vi.fn() };
    render(<AuthorizePage session="cs_ready" action="authorise" cap="3600" nonce="n1" opener={opener} close={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("This meter is already running.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalledTimes(1));
  });

  it("FR_CHK_038_an_invalid_link_is_refused", async () => {
    render(<AuthorizePage session="cs_ready" action="drain" nonce="n1" opener={null} close={vi.fn()} />);
    expect(await screen.findByText("This link is not valid.")).toBeInTheDocument();
  });
});
