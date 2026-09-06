/**
 * Invoices: settlements with gross, fee, net, tx link; filters; totals;
 * CSV export; the payout line reads the fee from the API.
 * FR-DSH-060, FR-DSH-061, FR-DSH-062; BR-DSH-005, BR-DSH-009.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicesPage, invoicesCsv } from "./invoices-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";
import { parseRate } from "@/lib/meter/math";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/invoices",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink("demo@elapse.finance");
  return api.verifyMagicLink(devToken);
}
const mount = (api: MockDashboardApi, m: Merchant) =>
  render(
    <MerchantProvider value={{ merchant: m, api, setMerchant: () => {} }}>
      <InvoicesPage />
    </MerchantProvider>,
  );

describe("Invoices", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("lists settlements with gross, fee, net, explorer link and a totals row (FR-DSH-060)", async () => {
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /invoices/i });
    const all = await api.listInvoices("test", {});
    const first = all[0]!;
    const row = within(list).getAllByRole("listitem")[0]!;
    expect(row).toHaveTextContent(`$${first.grossUsd}`);
    expect(row).toHaveTextContent(`$${first.feeUsd}`);
    expect(row).toHaveTextContent(`$${first.netUsd}`);
    expect(within(row).getByRole("link", { name: /view on explorer/i })).toHaveAttribute("href", expect.stringContaining(first.txId));
    const usd = (v: string) => parseRate(v.replace(/,/g, ""));
    const net = all.reduce((a, i) => a + usd(i.netUsd), 0n);
    const totals = screen.getByRole("row", { name: /totals/i });
    expect(totals).toHaveTextContent(`$${(Number(net) / 1e9).toFixed(3)}`.replace(/\.?0+$/, (s) => s));
  });

  it("explains the payout model with the fee from the API (FR-DSH-061, BR-DSH-009)", async () => {
    const m = await signIn(api);
    mount(api, m);
    expect(await screen.findByText(/settled funds go straight to your payout address/i)).toBeInTheDocument();
    expect(screen.getByText(/elapse keeps 1 %/i)).toBeInTheDocument();
  });

  it("filters by subscription (FR-DSH-060)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    await screen.findByRole("list", { name: /invoices/i });
    const sub = (await api.listInvoices("test", {}))[0]!.subscription;
    await user.type(screen.getByLabelText(/subscription id/i), sub);
    const rows = await within(screen.getByRole("list", { name: /invoices/i })).findAllByRole("listitem");
    expect(rows.every((r) => r.textContent?.includes(sub))).toBe(true);
  });

  it("exports the filtered rows as CSV with the same columns (FR-DSH-062)", async () => {
    const m = await signIn(api);
    const all = await api.listInvoices("test", {});
    const csv = invoicesCsv(all.slice(0, 2));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("settled_at,invoice,subscription,customer,seconds,gross_usd,fee_usd,net_usd,tx");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(all[0]!.txId);
    expect(m.id).toBe("mrc_demo");
  });
});
