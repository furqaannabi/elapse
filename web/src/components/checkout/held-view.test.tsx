/**
 * The held view: the subscriber has funded a merchant-mode session and the merchant has not
 * started the meter. Nothing ticks, nothing is charged, and the money comes back on its own.
 *
 * FR-CHK-034 (held view), BR-CHK-004 (Stop is a neutral outline).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeldView } from "./held-view";

const START_BY = 1_757_000_900_000;
const props = {
  productName: "Serverless runtime",
  merchantName: "Northwind Compute",
  successHref: "https://northwind.example/console?session_id=cs_1",
  hold: { startBy: START_BY, heldUsd: "14.4" },
  onStop: vi.fn(),
};
const clock = new Date(START_BY).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

describe("HeldView", () => {
  it("FR_CHK_034_says_what_is_held_that_nothing_is_charged_and_when_it_comes_back", () => {
    render(<HeldView {...props} />);
    expect(screen.getByRole("heading", { name: "Waiting for Northwind Compute to start" })).toBeTruthy();
    expect(screen.getByText("$14.40 held")).toBeTruthy();
    expect(screen.getByText("You haven't been charged.")).toBeTruthy();
    expect(screen.getByText(`If it hasn't started by ${clock}, it all comes back to you.`)).toBeTruthy();
    // No meter: nothing is accruing.
    expect(screen.queryByText(/Running/)).toBeNull();
  });

  it("FR_CHK_034_offers_back_to_the_merchant_and_stop", () => {
    const onStop = vi.fn();
    render(<HeldView {...props} onStop={onStop} />);
    const back = screen.getByRole("link", { name: /Back to Northwind Compute/ });
    expect(back.getAttribute("href")).toBe(props.successHref);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("FR_CHK_034_stop_is_disabled_and_says_so_while_it_is_being_submitted", () => {
    render(<HeldView {...props} busy />);
    const stop = screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
  });
});
