/**
 * Customers: split list with search; detail with subscriptions and events.
 * FR-DSH-050, FR-DSH-051; BR-DSH-005 (no wallet addresses).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerDetail } from "./customer-detail";
import { CustomersList } from "./customers-list";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/customers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSelectedLayoutSegment: () => null,
}));

async function signIn(api: MockDashboardApi): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink("demo@elapse.finance");
  return api.verifyMagicLink(devToken);
}
const mount = (api: MockDashboardApi, m: Merchant, ui: React.ReactNode) =>
  render(<MerchantProvider value={{ merchant: m, api, setMerchant: () => {} }}>{ui}</MerchantProvider>);

describe("Customers", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("lists customers with email or a passkey label, counts, total settled; searches (FR-DSH-050)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m, <CustomersList />);
    const list = await screen.findByRole("list", { name: /customers/i });
    const all = await api.listCustomers("test", {});
    const anon = all.find((c) => !c.email)!;
    expect(within(list).getByText(anon.id).closest("li")).toHaveTextContent(/passkey user/i);
    const withEmail = all.find((c) => c.email)!;
    expect(within(list).getByText(withEmail.email!).closest("li")).toHaveTextContent(`$${withEmail.totalSettledUsd}`);
    await user.type(screen.getByRole("searchbox", { name: /search customers/i }), withEmail.email!.slice(0, 5));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /customers/i })).getAllByRole("listitem").length).toBeLessThan(all.length));
  });

  it("shows a customer's subscriptions and events without any address (FR-DSH-051, BR-DSH-005)", async () => {
    const m = await signIn(api);
    const c = (await api.listCustomers("test", {})).find((x) => x.subscriptionCount > 0)!;
    mount(api, m, <CustomerDetail customerId={c.id} />);
    expect(await screen.findByRole("heading", { name: c.email ?? c.id })).toBeInTheDocument();
    const subs = screen.getByRole("list", { name: /subscriptions/i });
    const expected = (await api.getCustomer(c.id)).subscriptions;
    expect(within(subs).getAllByRole("listitem")).toHaveLength(expected.length);
    expect(screen.getByRole("list", { name: /events/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});
