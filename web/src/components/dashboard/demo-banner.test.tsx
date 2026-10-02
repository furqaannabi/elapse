/**
 * FR-DSH-147: inside the demo account, one line says so and offers the judge their own account.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DemoBanner } from "./demo-banner";

describe("DemoBanner (FR-DSH-147)", () => {
  it("says this is the demo account and that changes reset every 6 hours", () => {
    render(<DemoBanner merchant={{ demo: true }} onBuildYourOwn={() => {}} />);
    const line = screen.getByRole("status", { name: "Demo account" });
    expect(line).toHaveTextContent("You’re in the demo account. Changes reset every 6 hours.");
  });

  it("offers the judge their own account: signs out, then the login page", async () => {
    const onBuildYourOwn = vi.fn();
    render(<DemoBanner merchant={{ demo: true }} onBuildYourOwn={onBuildYourOwn} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /sign in with your email to build your own/i }));
    expect(onBuildYourOwn).toHaveBeenCalled();
  });

  it("renders nothing outside a demo session", () => {
    const { container } = render(<DemoBanner merchant={{}} onBuildYourOwn={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
