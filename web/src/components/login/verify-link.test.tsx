/**
 * `/login/verify?token=` — consumes the link and redirects; expired or
 * used links say so and offer the way back. FR-DSH-011.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyLink } from "./verify-link";
import { createMockDashboardApi, resetMockDashboardApi } from "@/lib/dashboard/mock-api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
}));

describe("VerifyLink (FR-DSH-011)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    replace.mockReset();
  });

  it("opens the session and goes to the requested page", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    render(<VerifyLink api={api} token={devToken} next="/dashboard/products" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard/products"));
    await expect(api.me()).resolves.toMatchObject({ email: "demo@elapse.dev" });
  });

  it("only allows dashboard paths as next", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    render(<VerifyLink api={api} token={devToken} next="https://evil.example" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("names an expired link and offers the way back", async () => {
    let now = 1_756_800_000_000;
    const api = createMockDashboardApi({ now: () => now, latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    now += 16 * 60_000;
    render(<VerifyLink api={api} token={devToken} />);
    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute("href", "/login");
    expect(replace).not.toHaveBeenCalled();
  });

  it("names a used link", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
    await api.signOut();
    render(<VerifyLink api={api} token={devToken} />);
    expect(await screen.findByText(/already been used/i)).toBeInTheDocument();
  });
});
