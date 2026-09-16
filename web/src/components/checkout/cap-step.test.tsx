/**
 * The cap step: the subscriber chooses how long the meter may run, sees
 * the most it can cost, and starts with one confirmation.
 *
 * FR-CHK-003 (duration presets with the dollar maximum), BR-CHK-001 (no
 * chain words), BR-CHK-002 (the cap is the maximum exposure).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CapStep } from "./cap-step";

const rate = "0.004"; // $14.40 an hour

describe("CapStep", () => {
  it("offers 1 hour and 4 hours with the maximum each can cost", () => {
    render(<CapStep rateUsdPerSecond={rate} onChoose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /1 hour/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /4 hours/i })).toBeInTheDocument();
    expect(screen.getByText("$14.40")).toBeInTheDocument();
    expect(screen.getByText("$57.60")).toBeInTheDocument();
  });

  it("says unused time comes back and never says approve, permit, or wallet", () => {
    const { container } = render(<CapStep rateUsdPerSecond={rate} onChoose={vi.fn()} />);
    expect(screen.getByText(/only pay the seconds you use/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/permit|approve|allowance|wallet|token|0x/i);
  });

  it("passes the chosen cap in seconds", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<CapStep rateUsdPerSecond={rate} onChoose={onChoose} />);
    await user.click(screen.getByRole("radio", { name: /4 hours/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(onChoose).toHaveBeenCalledWith(14_400);
  });

  it("takes a custom duration in minutes", async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<CapStep rateUsdPerSecond={rate} onChoose={onChoose} />);
    await user.click(screen.getByRole("button", { name: /another length/i }));
    await user.type(screen.getByLabelText(/minutes/i), "90");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(onChoose).toHaveBeenCalledWith(5400);
  });

  it("will not continue on a custom duration that is not a number", async () => {
    const user = userEvent.setup();
    render(<CapStep rateUsdPerSecond={rate} onChoose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /another length/i }));
    expect(screen.getByRole("button", { name: /enter how long/i })).toBeDisabled();
  });

  it("FR_CHK_028_a_custom_length_is_whole_minutes_between_1_and_30_days_with_the_rule_shown", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<CapStep rateUsdPerSecond="0.004" onChoose={onChoose} busy={false} />);
    await user.click(screen.getByRole("button", { name: /another length/i }));
    const input = screen.getByRole("textbox", { name: /how many minutes/i });
    expect(input).toHaveAttribute("maxlength", "5");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
    await user.type(input, "0");
    expect(screen.getByText("Between 1 minute and 30 days.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter how long/i })).toBeDisabled();
    await user.clear(input);
    await user.type(input, "43201");
    expect(screen.getByText("Between 1 minute and 30 days.")).toBeInTheDocument();
    await user.clear(input);
    // FR-DSH-114 keystroke filter: the dot and the letter never land.
    await user.type(input, "1.5x");
    expect(input).toHaveValue("15");
    await user.clear(input);
    await user.type(input, "43200");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onChoose).toHaveBeenCalledWith(43200 * 60);
  });

  it("FR_CHK_007_a_last_cap_is_preselected_as_a_preset_or_as_the_custom_minutes", async () => {
    const onChoose = vi.fn();
    const { unmount } = render(<CapStep rateUsdPerSecond={rate} initialSeconds={14_400} onChoose={onChoose} />);
    expect(screen.getByRole("radio", { name: /4 hours/i })).toHaveAttribute("aria-checked", "true");
    unmount();
    render(<CapStep rateUsdPerSecond={rate} initialSeconds={5400} onChoose={onChoose} />);
    expect((screen.getByRole("textbox", { name: /how many minutes/i }) as HTMLInputElement).value).toBe("90");
    await userEvent.setup().click(screen.getByRole("button", { name: /^continue$/i }));
    expect(onChoose).toHaveBeenCalledWith(5400);
  });

  it("shows what the wallet can cover and disables what it cannot (FR-CHK-003)", () => {
    render(<CapStep rateUsdPerSecond={rate} availableUsd="20" onChoose={vi.fn()} />);
    expect(screen.getByText(/you have \$20\.00 available/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /4 hours/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /1 hour/i })).not.toBeDisabled();
  });
});

describe("CapStep with a short wallet (FR-CHK-031)", () => {
  it("FR_CHK_031_when_no_preset_is_affordable_Continue_becomes_Add_money_for_the_smallest_preset", async () => {
    const user = userEvent.setup();
    const onAddMoney = vi.fn();
    render(<CapStep rateUsdPerSecond="0.004" availableUsd="0.50" onChoose={vi.fn()} onAddMoney={onAddMoney} />);
    expect(screen.getByText(/you have \$0\.50 available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /add funds/i }));
    expect(onAddMoney).toHaveBeenCalledWith(3600);
  });

  it("FR_CHK_031_an_affordable_preset_keeps_Continue", () => {
    render(<CapStep rateUsdPerSecond="0.004" availableUsd="20" onChoose={vi.fn()} onAddMoney={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add funds/i })).toBeNull();
  });
});

describe("CapStep · FR-CHK-035 billing waits for the merchant", () => {
  it("FR_CHK_035_a_merchant_mode_product_says_billing_starts_when_the_merchant_starts", () => {
    render(<CapStep rateUsdPerSecond={rate} onChoose={vi.fn()} waitsForMerchant="Northwind Compute" />);
    expect(screen.getByText("Billing starts when Northwind Compute starts your session.")).toBeInTheDocument();
  });

  it("FR_CHK_035_a_checkout_mode_product_is_unchanged", () => {
    render(<CapStep rateUsdPerSecond={rate} onChoose={vi.fn()} />);
    expect(screen.queryByText(/billing starts when/i)).toBeNull();
  });
});
