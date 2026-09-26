import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The chart strip is a canvas; jsdom has no 2D context.
vi.mock("@/components/meter/chart-strip", () => ({ ChartStrip: () => <div data-testid="strip" /> }));

import { Hero } from "./hero";

describe("FR-LND-014 hero for both readers", () => {
  it("FR_LND_014_keeps_the_headline_and_speaks_for_the_merchant_in_the_subline", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You only pay what elapsed.");
    expect(screen.getByText(/paid out in dollars as it accrues/i)).toBeInTheDocument();
  });

  it("FR_LND_014_offers_one_button_per_reader", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: /start integrating/i })).toHaveAttribute("href", "https://docs.elapse.finance/quickstart");
    // FR-LND-014 amended again 2026-09-26: straight to Acme GPU, a page that exists, so the homepage
    // never waits on the examples' root page being deployed.
    expect(screen.getByRole("link", { name: /see the demo/i })).toHaveAttribute("href", "https://examples.elapse.finance/saas/");
  });

  it("FR_LND_015_the_merchant_readout_sits_in_the_panel_with_the_example_at_rest", () => {
    render(<Hero />);
    expect(screen.getByText(/merchant receives/i)).toBeInTheDocument();
    expect(screen.getByText(/^example/)).toBeInTheDocument();
  });
});
