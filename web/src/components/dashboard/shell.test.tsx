/**
 * The dashboard shell: sidebar, top bar, test/live toggle and banner.
 *
 * FR-DSH-001 (nav with active state), FR-DSH-002 (top bar contents),
 * FR-DSH-003 (test default, banner only in test, remembered).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardShell } from "./shell";
import type { Merchant } from "@/lib/dashboard/types";
import { MODE_STORAGE_KEY } from "@/lib/dashboard/mode";

let pathname = "/dashboard/subscriptions/sub_1";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const merchant: Merchant = {
  id: "mrc_demo",
  email: "demo@elapse.dev",
  name: "Nimbus",
  supportEmail: null,
  supportUrl: null,
  payoutAddress: null,
  feeBps: 100,
  branding: { name: "Nimbus" },
  createdAt: 0,
};

describe("DashboardShell", () => {
  beforeEach(() => {
    localStorage.clear();
    pathname = "/dashboard/subscriptions/sub_1";
  });

  it("renders the eight sections and marks the current one (FR-DSH-001)", () => {
    render(
      <DashboardShell merchant={merchant}>
        <p>content</p>
      </DashboardShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(
      expect.arrayContaining(["Home", "Products", "Subscriptions", "Customers", "Invoices", "Balance & payouts", "Settings"]),
    );
    expect(within(nav).getByRole("link", { name: "Subscriptions" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("shows the merchant name and a sign-out in the top bar (FR-DSH-002)", () => {
    render(
      <DashboardShell merchant={merchant} onSignOut={() => {}}>
        <p>content</p>
      </DashboardShell>,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("Nimbus");
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });

  it("starts in test mode with the banner and switches to live (FR-DSH-003)", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell merchant={merchant}>
        <p>content</p>
      </DashboardShell>,
    );
    expect(screen.getByRole("status", { name: /test mode/i })).toHaveTextContent(/testnet/i);
    await user.click(screen.getByRole("radio", { name: "Live" }));
    expect(screen.queryByRole("status", { name: /test mode/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("live");
  });
});
