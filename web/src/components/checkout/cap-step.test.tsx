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

  it("shows what the wallet can cover and disables what it cannot (FR-CHK-003)", () => {
    render(<CapStep rateUsdPerSecond={rate} availableUsd="20" onChoose={vi.fn()} />);
    expect(screen.getByText(/you have \$20\.00 available/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /4 hours/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /1 hour/i })).not.toBeDisabled();
  });
});
