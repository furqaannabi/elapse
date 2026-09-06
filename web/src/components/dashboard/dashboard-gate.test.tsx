/**
 * `DashboardGate` — loads the session, redirects to /login when there is
 * none, captures first-run details, then renders the shell.
 *
 * FR-DSH-012 (redirect with next=), FR-DSH-013 (first-run capture),
 * FR-DSH-014 (sign out returns to /login).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGate } from "./dashboard-gate";
import { createMockDashboardApi, resetMockDashboardApi } from "@/lib/dashboard/mock-api";

const replace = vi.fn();
let pathname = "/dashboard/products";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
}));

describe("DashboardGate", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    replace.mockReset();
    pathname = "/dashboard/products";
  });

  it("redirects to /login?next= when there is no session (FR-DSH-012)", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fproducts"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders the shell and the page for a signed-in merchant", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    await api.verifyMagicLink(devToken);
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    expect(await screen.findByText("secret")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Nimbus");
  });

  it("asks a new merchant for a business name first (FR-DSH-013)", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("new@example.com");
    await api.verifyMagicLink(devToken);
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    const name = await screen.findByLabelText(/business name/i);
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    await user.type(name, "Acme GPU");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("secret")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Acme GPU");
  });

  it("signs out to /login (FR-DSH-014)", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    await api.verifyMagicLink(devToken);
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    await screen.findByText("secret");
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /sign out/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
