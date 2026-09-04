/**
 * Balance & payouts: balance header, withdraw sheet (documented path, no
 * integration), append-only ledger with filters, totals, CSV, reversal.
 * FR-DSH-120…125; BR-DSH-011, BR-DSH-012, BR-DSH-013.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BalancePage, ledgerCsv } from "./balance-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/balance",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi, email = "demo@elapse.dev"): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink(email);
  const m = await api.verifyMagicLink(devToken);
  return m.name ? m : api.completeFirstRun({ name: "Acme" });
}
const mount = (api: MockDashboardApi, m: Merchant) =>
  render(
    <MerchantProvider value={{ merchant: m, api, setMerchant: () => {} }}>
      <BalancePage />
    </MerchantProvider>,
  );

describe("Balance & payouts", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("shows the balance at the payout address, the shortened address, and settled this month (FR-DSH-120)", async () => {
    const m = await signIn(api);
    mount(api, m);
    const b = await api.getBalance("test");
    // Scoped by its own label: the month total can equal the all-time total.
    const label = await screen.findByText("At your payout address");
    expect(label.closest("div")).toHaveTextContent(`$${b.ausdUsd}`);
    expect(screen.getByText(/0x7a3f…8a90/)).toBeInTheDocument();
    expect(screen.getByText(/settled this month/i).closest("div")).toHaveTextContent(`$${b.settledThisMonthNetUsd}`);
    expect(document.body.textContent).not.toMatch(/elapse balance/i);
  });

  it("is an empty state pointing to Settings when no payout address is set (FR-DSH-120)", async () => {
    const m = await signIn(api, "fresh@example.com");
    mount(api, m);
    expect(await screen.findByText(/no payout address yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set it in settings/i })).toHaveAttribute("href", "/dashboard/settings");
  });

  it("withdraw opens a sheet that explains today's path and never says coming soon (FR-DSH-121, BR-DSH-013)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    await user.click(await screen.findByRole("button", { name: /withdraw to bank/i }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent(/already yours/i);
    expect(sheet).not.toHaveTextContent(/coming soon/i);
    expect(within(sheet).getByRole("link", { name: /how to cash out/i })).toHaveAttribute("href", expect.stringContaining("docs"));
  });

  it("lists the ledger with kinds, signed amounts, tx links; filters by kind; marks reversed rows (FR-DSH-122/124)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /ledger/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(10);
    const all = await api.listLedger("test", {});
    const feeRow = all.find((l) => l.kind === "fee")!;
    const li = within(list).getByText(feeRow.id).closest("li")!;
    expect(li).toHaveTextContent(/^.*Fee.*$/);
    expect(li).toHaveTextContent(`−$${feeRow.amountUsd}`);
    const reversed = all.find((l) => l.reversedBy)!;
    expect(within(list).getByText(reversed.id).closest("li")).toHaveTextContent(/reversed/i);
    await user.selectOptions(screen.getByLabelText(/filter by kind/i), "refund");
    await waitFor(() => {
      const r = within(screen.getByRole("list", { name: /ledger/i })).getAllByRole("listitem");
      expect(r.every((x) => /refund/i.test(x.textContent ?? ""))).toBe(true);
    });
  });

  it("totals per kind for the filtered range and exports CSV (FR-DSH-123)", async () => {
    const m = await signIn(api);
    mount(api, m);
    await screen.findByRole("list", { name: /ledger/i });
    const totals = screen.getByRole("region", { name: /totals/i });
    expect(totals).toHaveTextContent(/deposits/i);
    expect(totals).toHaveTextContent(/settlements/i);
    expect(totals).toHaveTextContent(/fees/i);
    expect(totals).toHaveTextContent(/refunds/i);
    const csv = ledgerCsv((await api.listLedger("test", {})).slice(0, 1));
    expect(csv.split("\n")[0]).toBe("block_time,entry,kind,amount_usd,subscription,customer,tx,invoice,reversed_by");
  });
});
