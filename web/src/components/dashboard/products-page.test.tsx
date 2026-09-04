/**
 * Products: table, create/edit drawer with live per-minute/per-hour,
 * Copy Checkout URL, archive with confirm.
 * FR-DSH-030, FR-DSH-031, FR-DSH-032, FR-DSH-033; BR-DSH-007, BR-DSH-010.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsPage } from "./products-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import { setMode } from "@/lib/dashboard/mode";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/products",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi, email = "demo@elapse.dev"): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink(email);
  const m = await api.verifyMagicLink(devToken);
  return m.name ? m : api.completeFirstRun({ name: "Acme" });
}
function mount(api: MockDashboardApi, merchant: Merchant) {
  return render(
    <MerchantProvider value={{ merchant, api, setMerchant: () => {} }}>
      <ProductsPage />
    </MerchantProvider>,
  );
}

describe("ProductsPage", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("lists active products with rate, per hour, active meters; archived hidden by default (FR-DSH-030)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /products/i });
    const row = within(list).getByText("GPU · 4090").closest("li")!;
    expect(row).toHaveTextContent("$0.004");
    expect(row).toHaveTextContent("$14.40");
    expect(within(list).queryByText("GPU · 3090")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /show archived/i }));
    expect(await within(screen.getByRole("list", { name: /products/i })).findByText("GPU · 3090")).toBeInTheDocument();
  });

  it("creates a product; the drawer shows per-minute and per-hour as you type (FR-DSH-031)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api, "fresh@example.com");
    mount(api, m);
    await user.click(await screen.findByRole("button", { name: /new product/i }));
    const drawer = await screen.findByRole("dialog");
    await user.type(within(drawer).getByLabelText(/^name/i), "Render minute");
    const rate = within(drawer).getByLabelText(/rate per second/i);
    await user.type(rate, "0.004");
    expect(drawer).toHaveTextContent("$0.24 / min");
    expect(drawer).toHaveTextContent("$14.40 / hour");
    await user.clear(rate);
    await user.type(rate, "abc");
    await user.click(within(drawer).getByRole("button", { name: /create product/i }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent(/decimal/i);
    await user.clear(rate);
    await user.type(rate, "0.0015");
    await user.click(within(drawer).getByRole("button", { name: /create product/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("list", { name: /products/i })).getByText("Render minute")).toBeInTheDocument();
  });

  it("copies a checkout URL for a product (FR-DSH-032)", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /products/i });
    const row = within(list).getByText("GPU · 4090").closest("li")!;
    await user.click(within(row).getByRole("button", { name: /copy checkout url/i }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.stringMatching(/\/c\/cs_/)));
  });

  it("asks before creating a live link (FR-DSH-032)", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const m = await signIn(api);
    setMode("live");
    mount(api, m);
    const list = await screen.findByRole("list", { name: /products/i });
    const row = within(list).getAllByRole("listitem")[0]!;
    await user.click(within(row).getByRole("button", { name: /copy checkout url/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/real/i);
    await user.click(within(dialog).getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.stringMatching(/\/c\/cs_/)));
  });

  it("archives after a confirmation naming the product (FR-DSH-033, BR-DSH-010)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /products/i });
    const row = within(list).getByText("Live seat").closest("li")!;
    await user.click(within(row).getByRole("button", { name: /actions for live seat/i }));
    await user.click(await screen.findByRole("menuitem", { name: /archive/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Live seat");
    expect(dialog).toHaveTextContent(/running meters continue/i);
    await user.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /products/i })).queryByText("Live seat")).not.toBeInTheDocument());
  });
});
