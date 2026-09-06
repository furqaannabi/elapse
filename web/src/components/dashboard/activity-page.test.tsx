/** Settings → Activity: the audit log, read-only. FR-DSH-140, 141, 142. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPage, activityCsv } from "./activity-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/settings/activity",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("ActivityPage", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("lists actions newest first with actor, target and ip; filters; never shows secrets", async () => {
    const user = userEvent.setup();
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    const m = await api.verifyMagicLink(devToken);
    const { secret } = await api.createKey("test", "Leaky");
    render(
      <MerchantProvider value={{ merchant: m, api, setMerchant: () => {} }}>
        <ActivityPage />
      </MerchantProvider>,
    );
    const list = await screen.findByRole("list", { name: /activity/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/key created/i);
    expect(rows[0]).toHaveTextContent("demo@elapse.finance");
    expect(rows[0]).toHaveTextContent("203.0.113.4");
    expect(document.body.textContent).not.toContain(secret);
    await user.selectOptions(screen.getByLabelText(/filter by action/i), "signin");
    await waitFor(() => {
      const r = within(screen.getByRole("list", { name: /activity/i })).getAllByRole("listitem");
      expect(r.every((x) => /signed in/i.test(x.textContent ?? ""))).toBe(true);
    });
    const csv = activityCsv(await api.listActivity({}));
    expect(csv.split("\n")[0]).toBe("at,actor,action,target,ip");
  });
});
