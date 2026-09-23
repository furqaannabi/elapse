/**
 * `DashboardGate` — loads the session, redirects to /login when there is
 * none, captures first-run details, then renders the shell.
 *
 * FR-DSH-012 (redirect with next=), FR-DSH-013 (first-run capture),
 * FR-DSH-014 (sign out returns to /login).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

  it("shows the real chrome while the session loads, never a blank page (FR-DSH-012)", async () => {
    const api = createMockDashboardApi({ latencyMs: 50 });
    // A merchant who has been here before: the shell is the right loading frame for them.
    localStorage.setItem("elapse.dashboard.returning", "1");
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    await api.verifyMagicLink(devToken);
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    // Before `me()` answers: the wordmark and the section list are already
    // on screen, the page area says it is loading, and nothing is blank.
    expect(screen.getByRole("link", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveTextContent(/loading/i);
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    // After: the page replaces the placeholder and the busy flag clears.
    expect(await screen.findByText("secret")).toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy", "true");
  });

  it("shows a visitor with no session no dashboard chrome at all before the redirect", async () => {
    // 2026-09-23, found while recording: the Dashboard link on the landing page gave a signed-out
    // visitor a glimpse of the shell — wordmark, sections, top bar — before /login replaced it.
    // Nothing of theirs was on screen, but a dashboard they do not have was.
    const api = createMockDashboardApi({ latencyMs: 50 });
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fproducts"));
  });

  it("remembers a merchant who signed in, and forgets them when they sign out", async () => {
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
    expect(localStorage.getItem("elapse.dashboard.returning")).toBe("1");

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /sign out/i }));
    await waitFor(() => expect(localStorage.getItem("elapse.dashboard.returning")).toBeNull());
  });

  it("forgets a remembered session the API no longer honours", async () => {
    // The flag can outlive the cookie — expired, revoked, signed out elsewhere. A 401 is the
    // platform saying so, so the next visit must not be shown the shell on the strength of it.
    localStorage.setItem("elapse.dashboard.returning", "1");
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(
      <DashboardGate api={api}>
        <p>secret</p>
      </DashboardGate>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fproducts"));
    expect(localStorage.getItem("elapse.dashboard.returning")).toBeNull();
  });

  it("renders the same frame on the server as on a first client paint, whatever is remembered", () => {
    // The dashboard layout is a server component, so this gate is server-rendered before it
    // hydrates. `localStorage` does not exist there, so the server can only ever emit the quiet
    // frame — reading the flag during render would make a returning merchant's first client render
    // disagree with the HTML it is hydrating, which is a mismatch, not an optimisation.
    localStorage.setItem("elapse.dashboard.returning", "1");
    const html = renderToString(
      <DashboardGate api={createMockDashboardApi({ latencyMs: 50 })}>
        <p>secret</p>
      </DashboardGate>,
    );
    expect(html).not.toContain("Products");
    expect(html).not.toContain("secret");
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
