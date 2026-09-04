/**
 * Developers → API keys. FR-DSH-070 (list), FR-DSH-071 (create, reveal
 * once), FR-DSH-072 (roll with grace), FR-DSH-073 (revoke), FR-DSH-074
 * (mode-scoped), BR-DSH-001, BR-DSH-010.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeysPage } from "./keys-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import { setMode } from "@/lib/dashboard/mode";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/developers/keys",
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
      <KeysPage />
    </MerchantProvider>,
  );
}

describe("KeysPage", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("shows the publishable key in full and secret keys masked (FR-DSH-070)", async () => {
    const m = await signIn(api);
    mount(api, m);
    const { publishable, secret } = await api.listKeys("test");
    expect(await screen.findByText(publishable)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /secret keys/i });
    for (const k of secret) {
      const row = within(list).getByText(k.name).closest("li")!;
      expect(row).toHaveTextContent(`${k.prefix}…${k.last4}`);
    }
    expect(within(list).getByText("Laptop (old)").closest("li")).toHaveTextContent(/revoked/i);
  });

  it("creates a key, reveals it once, then masks it (FR-DSH-071, BR-DSH-001)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api, "fresh@example.com");
    mount(api, m);
    await user.click(await screen.findByRole("button", { name: /create secret key/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/name/i), "CI runner");
    await user.click(within(dialog).getByRole("button", { name: /^create key$/i }));
    const reveal = await screen.findByRole("dialog");
    const secret = within(reveal).getByTestId("secret-key").textContent!;
    expect(secret).toMatch(/^sk_test_/);
    expect(reveal).toHaveTextContent(/won't be shown again/i);
    await user.click(within(reveal).getByRole("button", { name: /saved it/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const list = screen.getByRole("list", { name: /secret keys/i });
    expect(within(list).getByText("CI runner").closest("li")).toHaveTextContent(`…${secret.slice(-4)}`);
    expect(document.body.textContent).not.toContain(secret);
  });

  it("rolls a key with a chosen grace and shows the expiry (FR-DSH-072)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /secret keys/i });
    const row = within(list).getByText("CI").closest("li")!;
    await user.click(within(row).getByRole("button", { name: /actions for ci/i }));
    await user.click(await screen.findByRole("menuitem", { name: /roll/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /24 hours/i }));
    await user.click(within(dialog).getByRole("button", { name: /roll key/i }));
    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByTestId("secret-key").textContent).toMatch(/^sk_test_/);
    await user.click(within(reveal).getByRole("button", { name: /saved it/i }));
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: /secret keys/i })).getAllByText("CI");
      expect(rows).toHaveLength(2);
    });
    expect(screen.getByText(/expires in (24|23) h/i)).toBeInTheDocument();
  });

  it("revokes after a confirmation that names the key (FR-DSH-073, BR-DSH-010)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const list = await screen.findByRole("list", { name: /secret keys/i });
    const row = within(list).getByText("CI").closest("li")!;
    await user.click(within(row).getByRole("button", { name: /actions for ci/i }));
    await user.click(await screen.findByRole("menuitem", { name: /revoke/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("CI");
    await user.click(within(dialog).getByRole("button", { name: /revoke key/i }));
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: /secret keys/i })).getByText("CI").closest("li")).toHaveTextContent(/revoked/i),
    );
  });

  it("switches lists with the mode (FR-DSH-074)", async () => {
    const m = await signIn(api);
    mount(api, m);
    await screen.findByText((await api.listKeys("test")).publishable);
    setMode("live");
    expect(await screen.findByText((await api.listKeys("live")).publishable)).toBeInTheDocument();
  });
});
