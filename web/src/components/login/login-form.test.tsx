/**
 * `/login` — email in, "check your inbox" out; resend limited to once per
 * 30 s. FR-DSH-010.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { createMockDashboardApi, MOCK_DEMO_PIN, resetMockDashboardApi } from "@/lib/dashboard/mock-api";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
}));

describe("LoginForm (FR-DSH-010)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    search = "";
    replace.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("sends a link and shows the inbox state with the address", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    await user.type(screen.getByLabelText(/email/i), "demo@elapse.finance");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText("demo@elapse.finance")).toBeInTheDocument();
  });

  it("FR_DSH_114_names_the_problem_with_an_invalid_email_and_holds_the_button_until_it_is_fixed", async () => {
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    const email = screen.getByLabelText(/email/i);
    expect(email).toHaveAttribute("maxlength", "254");
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    await user.type(email, "nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    await user.type(email, "@acme.test");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
  });

  it("disables resend for 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    await user.type(screen.getByLabelText(/email/i), "demo@elapse.finance");
    await user.click(screen.getByRole("button", { name: /send/i }));
    const resend = await screen.findByRole("button", { name: /resend/i });
    expect(resend).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(30_500);
    });
    expect(screen.getByRole("button", { name: /resend/i })).toBeEnabled();
  });

  it("FR_DSH_146_offers_the_demo_account_as_a_secondary_action_when_the_api_says_it_is_available", async () => {
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    const demo = await screen.findByRole("button", { name: /try the demo account/i });
    const send = screen.getByRole("button", { name: /send sign-in link/i });
    // Secondary: after the email form in reading order.
    expect(send.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("FR_DSH_146_hides_the_demo_account_when_it_is_not_available", async () => {
    const api = { ...createMockDashboardApi({ latencyMs: 0 }), demoAvailable: async () => false };
    render(<LoginForm api={api} />);
    await screen.findByRole("button", { name: /send sign-in link/i });
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /try the demo account/i })).toBeNull();
  });

  it("FR_DSH_146_at_demo_1_the_demo_account_comes_first_and_signing_in_opens_the_dashboard", async () => {
    search = "demo=1";
    const user = userEvent.setup();
    const api = createMockDashboardApi({ latencyMs: 0 });
    render(<LoginForm api={api} />);
    const demo = await screen.findByRole("button", { name: /try the demo account/i });
    const send = screen.getByRole("button", { name: /send sign-in link/i });
    expect(demo.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(demo);
    await user.keyboard(MOCK_DEMO_PIN);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});

