/**
 * Subscriptions: split list with live readouts and filters; detail with
 * the panel readout, funded/settled, timeline, settlements, and Cancel.
 * FR-DSH-040, FR-DSH-041, FR-DSH-042, FR-DSH-043, FR-DSH-044; BR-DSH-008.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionDetail } from "./subscription-detail";
import { SubscriptionsList } from "./subscriptions-list";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

let pathname = "/dashboard/subscriptions";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSelectedLayoutSegment: () => null,
}));

async function signIn(api: MockDashboardApi): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink("demo@elapse.dev");
  return api.verifyMagicLink(devToken);
}
function mount(api: MockDashboardApi, merchant: Merchant, ui: React.ReactNode) {
  return render(<MerchantProvider value={{ merchant, api, setMerchant: () => {} }}>{ui}</MerchantProvider>);
}

describe("Subscriptions", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    pathname = "/dashboard/subscriptions";
  });

  it("lists meters with a status word, product, customer, and a live readout for active ones (FR-DSH-040)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m, <SubscriptionsList />);
    const list = await screen.findByRole("list", { name: /subscriptions/i });
    const active = (await api.listSubscriptions("test", { status: "active" }))[0]!;
    const row = within(list).getByText(active.id).closest("li")!;
    expect(row).toHaveTextContent(/active/i);
    expect(row).toHaveTextContent(active.product.name);
    expect(within(row).getByRole("timer")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/filter by status/i), "canceled");
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: /subscriptions/i })).getAllByRole("listitem");
      expect(rows.every((r) => /canceled/i.test(r.textContent ?? ""))).toBe(true);
    });
  });

  it("shows the detail: panel readout, funded, settled, remaining, timeline, settlements (FR-DSH-041/042)", async () => {
    const m = await signIn(api);
    const sub = (await api.listSubscriptions("test", { status: "active" })).find((s) => s.settledUsd !== "0.000")!;
    mount(api, m, <SubscriptionDetail subscriptionId={sub.id} />);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(screen.getByText(/funded/i).closest("div")).toHaveTextContent(`$${sub.fundedUsd}`);
    expect(screen.getByText(/^settled$/i).closest("div")).toHaveTextContent(`$${sub.settledUsd}`);
    expect(screen.getByText(/runtime left/i)).toBeInTheDocument();
    const timeline = screen.getByRole("list", { name: /timeline/i });
    const items = within(timeline).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("checkout.session.completed");
    expect(items[1]).toContain("subscription.created");
    const settlements = screen.getByRole("list", { name: /settlements/i });
    const invoices = (await api.getSubscription(sub.id)).invoices;
    expect(within(settlements).getAllByRole("listitem")).toHaveLength(invoices.length);
    expect(within(settlements).getAllByRole("listitem")[0]).toHaveTextContent(`$${invoices[0]!.grossUsd}`);
    expect(within(settlements).getAllByRole("link", { name: /view on explorer/i })[0]).toHaveAttribute("href", expect.stringContaining(invoices[0]!.txId));
  });

  it("cancels after a confirmation that states seconds and refund; status flips (FR-DSH-043, BR-DSH-008)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const sub = (await api.listSubscriptions("test", { status: "active" }))[0]!;
    mount(api, m, <SubscriptionDetail subscriptionId={sub.id} />);
    await user.click(await screen.findByRole("button", { name: /cancel meter/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/the meter stops now/i);
    expect(dialog).toHaveTextContent(/refunded the rest/i);
    expect(dialog).toHaveTextContent(/\d+ seconds? so far/i);
    await user.click(within(dialog).getByRole("button", { name: /stop the meter/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/^Canceled$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel meter/i })).not.toBeInTheDocument();
    expect((await api.getSubscription(sub.id)).subscription.status).toBe("canceled");
  });

  it("offers Copy id (FR-DSH-044)", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const m = await signIn(api);
    const sub = (await api.listSubscriptions("test", {}))[0]!;
    mount(api, m, <SubscriptionDetail subscriptionId={sub.id} />);
    await user.click(await screen.findByRole("button", { name: /copy subscription id/i }));
    expect(write).toHaveBeenCalledWith(sub.id);
  });
});
