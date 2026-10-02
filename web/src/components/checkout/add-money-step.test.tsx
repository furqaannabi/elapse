/**
 * The Add funds step (FR-CHK-031): balance, needed, address, copy, and the
 * return to the cap step once the wallet covers it. The one screen that may
 * name the token and the network; nothing else on it is chain vocabulary.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutBalance } from "@/lib/checkout/types";
import { AddMoneyStep } from "./add-money-step";
import { FaucetRefusedError } from "@/lib/checkout/mock-api";

const short: CheckoutBalance = { balanceUsd: "3.10", needsFunding: true, receiveAddress: "0x2f1e8c9a4b7d6e5f0a1b2c3d4e5f60718293a4b5", token: "AUSD", network: "Monad testnet" };

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("AddMoneyStep", () => {
  it("FR_CHK_031_shows_balance_needed_the_address_and_one_sentence_naming_token_and_network", async () => {
    render(<AddMoneyStep neededUsd="14.4" initial={short} refresh={async () => short} onFunded={vi.fn()} cancelHref="https://nimbus.example/cancel" />);
    expect(screen.getByRole("heading", { name: /add funds to start/i })).toBeInTheDocument();
    expect(screen.getByText("$3.10")).toBeInTheDocument();
    expect(screen.getByText("$14.40")).toBeInTheDocument();
    expect(screen.getByText(short.receiveAddress)).toBeInTheDocument();
    expect(screen.getByText(/send AUSD on Monad testnet to this address/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /address as a qr code/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /not now/i })).toHaveAttribute("href", "https://nimbus.example/cancel");
    // No other chain vocabulary.
    expect(document.body.textContent).not.toMatch(/wallet|gas|seed|transaction|contract|explorer|fee/i);
  });

  it("FR_CHK_031_copy_puts_the_address_on_the_clipboard_and_says_so", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<AddMoneyStep neededUsd="14.4" initial={short} refresh={async () => short} onFunded={vi.fn()} cancelHref="#" />);
    await user.click(screen.getByRole("button", { name: /copy address/i }));
    expect(write).toHaveBeenCalledWith(short.receiveAddress);
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("FR_CHK_031_polls_every_five_seconds_and_hands_back_once_the_balance_covers_the_cap", async () => {
    let balance = "3.10";
    const refresh = vi.fn(async () => ({ ...short, balanceUsd: balance }));
    const onFunded = vi.fn();
    render(<AddMoneyStep neededUsd="14.4" initial={short} refresh={refresh} onFunded={onFunded} cancelHref="#" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onFunded).not.toHaveBeenCalled();
    balance = "20.00";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    await waitFor(() => expect(screen.getByText("$20.00")).toBeInTheDocument());
    expect(onFunded).toHaveBeenCalledWith(expect.objectContaining({ balanceUsd: "20.00" }));
  });
});

describe("FR-CHK-041 Get test AUSD", () => {
  const offered = { ...short, faucetAmountUsd: "15" };
  const render15 = (request: () => Promise<void>, refresh = async () => short) =>
    render(<AddMoneyStep neededUsd="14.4" initial={offered} refresh={refresh} onFunded={vi.fn()} cancelHref="#" faucet={{ amountUsd: "15", request }} />);

  it("FR_CHK_041_offers_the_drop_only_when_the_balance_offers_it", () => {
    const { unmount } = render15(async () => {});
    expect(screen.getByRole("button", { name: "Get 15 test AUSD" })).toBeInTheDocument();
    unmount();
    render(<AddMoneyStep neededUsd="14.4" initial={short} refresh={async () => short} onFunded={vi.fn()} cancelHref="#" />);
    expect(screen.queryByRole("button", { name: /test AUSD/i })).toBeNull();
  });

  it("FR_CHK_041_pressing_it_asks_once_and_says_it_is_on_its_way", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const request = vi.fn(async () => {});
    render15(request);
    await user.click(screen.getByRole("button", { name: "Get 15 test AUSD" }));
    const pending = await screen.findByRole("button", { name: "On its way…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("FR_CHK_041_the_poll_not_the_button_moves_the_window_on", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let balance = "3.10";
    const onFunded = vi.fn();
    render(
      <AddMoneyStep neededUsd="14.4" initial={offered} refresh={async () => ({ ...short, balanceUsd: balance })} onFunded={onFunded} cancelHref="#"
        faucet={{ amountUsd: "15", request: async () => { balance = "18.10"; } }} />,
    );
    await user.click(screen.getByRole("button", { name: "Get 15 test AUSD" }));
    expect(onFunded).not.toHaveBeenCalled(); // the drop is only on its way until the balance shows it
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    await waitFor(() => expect(onFunded).toHaveBeenCalledWith(expect.objectContaining({ balanceUsd: "18.10" })));
  });

  it.each([
    ["faucet_wallet_daily", /You['’]ve already had your test AUSD today\. Ask again after \d{1,2}:\d{2}/],
    ["faucet_ip_daily", /Too many requests from here today\. Try again after \d{1,2}:\d{2}/],
    ["faucet_daily", /The test faucet has given out its share for today\. Try again after \d{1,2}:\d{2}/],
    ["faucet_wallet_funded", /You already have 15 test AUSD or more/],
    ["faucet_unavailable", /The test faucet can['’]t pay right now\. Send test AUSD to the address below instead\./],
  ] as const)("FR_CHK_041_a_%s_refusal_replaces_the_button_with_one_sentence", async (code, sentence) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resetsAt = code === "faucet_wallet_funded" || code === "faucet_unavailable" ? null : Math.floor(Date.now() / 1000) + 3_600;
    render15(async () => { throw new FaucetRefusedError(code, resetsAt, "refused"); });
    await user.click(screen.getByRole("button", { name: "Get 15 test AUSD" }));
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test AUSD|On its way/i })).toBeNull();
    // The address stays as the way forward, and the step still says nothing it must not.
    expect(screen.getByText(short.receiveAddress)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/wallet|gas|seed|transaction|contract|explorer|fee|connect/i);
  });

  it("FR_CHK_041_a_failure_to_reach_the_faucet_can_be_tried_again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let fail = true;
    const request = vi.fn(async () => { if (fail) throw new Error("network"); });
    render15(request);
    await user.click(screen.getByRole("button", { name: "Get 15 test AUSD" }));
    expect(await screen.findByText(/couldn['’]t reach the test faucet/i)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Get 15 test AUSD" }));
    expect(await screen.findByRole("button", { name: "On its way…" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
