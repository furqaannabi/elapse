/**
 * `/dashboard` Home: the four-step checklist until the merchant has a
 * product, a secret key, an endpoint, and a succeeded delivery; then the
 * overview with stat tiles, running meters, and recent events.
 *
 * FR-DSH-020, FR-DSH-021, FR-DSH-022, FR-DSH-023.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./home";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import { setMode } from "@/lib/dashboard/mode";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi, email: string): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink(email);
  const m = await api.verifyMagicLink(devToken);
  return m.name ? m : api.completeFirstRun({ name: "Acme GPU" });
}

function mount(api: MockDashboardApi, merchant: Merchant) {
  return render(
    <MerchantProvider value={{ merchant, api, setMerchant: () => {} }}>
      <HomePage />
    </MerchantProvider>,
  );
}

describe("Home", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("shows the four-step checklist for a new merchant (FR-DSH-020)", async () => {
    const m = await signIn(api, "new@example.com");
    mount(api, m);
    const list = await screen.findByRole("list", { name: /first steps/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(/create a product/i);
    expect(items[1]).toHaveTextContent(/secret key/i);
    expect(items[2]).toHaveTextContent(/webhook endpoint/i);
    expect(items[3]).toHaveTextContent(/first event/i);
    expect(screen.getByText(/0 of 4/i)).toBeInTheDocument();
    expect(screen.queryByText(/running now/i)).not.toBeInTheDocument();
  });

  it("shows the overview once the checklist is complete (FR-DSH-021/022/023)", async () => {
    const m = await signIn(api, "demo@elapse.dev");
    mount(api, m);
    expect(await screen.findByRole("heading", { name: /running now/i })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /first steps/i })).not.toBeInTheDocument();
    expect(screen.getByText(/accrued today/i)).toBeInTheDocument();
    expect(screen.getByText(/settled this week/i)).toBeInTheDocument();
    expect(screen.getByText(/failed payments/i)).toBeInTheDocument();
    const running = screen.getByRole("list", { name: /running now/i });
    expect(within(running).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(running).getAllByRole("timer").length).toBeGreaterThan(0);
    const recent = screen.getByRole("list", { name: /recent events/i });
    expect(within(recent).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("scopes the overview by mode (FR-DSH-004)", async () => {
    const m = await signIn(api, "demo@elapse.dev");
    setMode("live");
    mount(api, m);
    expect(await screen.findByRole("heading", { name: /running now/i })).toBeInTheDocument();
    const testOverview = await api.overview("test");
    const liveOverview = await api.overview("live");
    expect(liveOverview.running.length).not.toBe(testOverview.running.length);
  });
});
