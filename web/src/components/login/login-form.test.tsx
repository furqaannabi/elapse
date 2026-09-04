/**
 * `/login` — email in, "check your inbox" out; resend limited to once per
 * 30 s. FR-DSH-010.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { createMockDashboardApi, resetMockDashboardApi } from "@/lib/dashboard/mock-api";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("LoginForm (FR-DSH-010)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
  });
  afterEach(() => vi.useRealTimers());

  it("sends a link and shows the inbox state with the address", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    await user.type(screen.getByLabelText(/email/i), "demo@elapse.dev");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText("demo@elapse.dev")).toBeInTheDocument();
  });

  it("rejects an invalid email with a named problem", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    await user.type(screen.getByLabelText(/email/i), "nope");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
  });

  it("disables resend for 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    await user.type(screen.getByLabelText(/email/i), "demo@elapse.dev");
    await user.click(screen.getByRole("button", { name: /send/i }));
    const resend = await screen.findByRole("button", { name: /resend/i });
    expect(resend).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(30_500);
    });
    expect(screen.getByRole("button", { name: /resend/i })).toBeEnabled();
  });
});
