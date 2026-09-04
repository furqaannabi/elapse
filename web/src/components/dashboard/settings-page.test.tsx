/**
 * Settings: profile, payout address (re-type to confirm), fee line,
 * branding with live checkout preview and contrast warning, notification
 * switches, danger zone. FR-DSH-100…105; BR-DSH-010.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings-page";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/settings",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink("demo@elapse.dev");
  return api.verifyMagicLink(devToken);
}
function mount(api: MockDashboardApi, merchant: Merchant) {
  const setMerchant = vi.fn();
  const r = render(
    <MerchantProvider value={{ merchant, api, setMerchant }}>
      <SettingsPage />
    </MerchantProvider>,
  );
  return { ...r, setMerchant };
}

describe("SettingsPage", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("saves the business profile (FR-DSH-100)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const { setMerchant } = mount(api, m);
    const name = screen.getByLabelText(/business name/i);
    await user.clear(name);
    await user.type(name, "Nimbus Cloud");
    await user.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(setMerchant).toHaveBeenCalledWith(expect.objectContaining({ name: "Nimbus Cloud" })));
  });

  it("changes the payout address only when re-typed, with the helper copy (FR-DSH-101)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const { setMerchant } = mount(api, m);
    expect(screen.getByText(/settled funds arrive here automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/0x7a3f…8a90/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /change payout address/i }));
    const dialog = await screen.findByRole("dialog");
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    await user.type(within(dialog).getByLabelText(/^new address/i), addr);
    await user.type(within(dialog).getByLabelText(/type it again/i), addr.slice(0, -1) + "9");
    await user.click(within(dialog).getByRole("button", { name: /^change address$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/match/i);
    await user.clear(within(dialog).getByLabelText(/type it again/i));
    await user.type(within(dialog).getByLabelText(/type it again/i), addr);
    await user.click(within(dialog).getByRole("button", { name: /^change address$/i }));
    await waitFor(() => expect(setMerchant).toHaveBeenCalledWith(expect.objectContaining({ payoutAddress: addr })));
  });

  it("shows the fee read-only from the API (FR-DSH-102)", async () => {
    const m = await signIn(api);
    mount(api, m);
    expect(screen.getByText(/platform fee: 1 % of every settlement/i)).toBeInTheDocument();
    expect(screen.getByText(/contact us for volume pricing/i)).toBeInTheDocument();
  });

  it("previews branding in the real checkout frame and warns on low contrast (FR-DSH-103)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const preview = screen.getByTestId("checkout-preview");
    expect(preview).toHaveTextContent("Nimbus");
    expect(preview).toHaveTextContent(/powered by\s*elapse/i);
    const accent = screen.getByLabelText(/^accent colour$/i);
    await user.clear(accent);
    await user.type(accent, "#1a1a1a");
    expect(await screen.findByText(/hard to see/i)).toBeInTheDocument();
    await user.clear(accent);
    await user.type(accent, "#3b82f6");
    await waitFor(() => expect(screen.queryByText(/hard to see/i)).not.toBeInTheDocument());
    expect(screen.getByText(/layout and copy are always ours/i)).toBeInTheDocument();
  });

  it("offers a colour picker on the swatch that stays in sync with the hex field and the preview (FR-DSH-103)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const picker = screen.getByLabelText(/pick accent colour/i) as HTMLInputElement;
    expect(picker.type).toBe("color");
    const hex = screen.getByLabelText(/^accent colour$/i) as HTMLInputElement;
    await user.clear(hex);
    await user.type(hex, "#3b82f6");
    expect(picker.value).toBe("#3b82f6");
    expect(screen.getByTestId("checkout-preview").querySelector("[style]")?.getAttribute("style")).toContain("#3b82f6");
    // Picking from the palette writes the hex back and re-tints the preview.
    await user.click(picker);
    // jsdom has no palette UI; a change event stands in for the pick.
    picker.value = "#2563eb";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => expect(hex.value).toBe("#2563eb"));
    expect(screen.getByTestId("checkout-preview").querySelector("[style]")?.getAttribute("style")).toContain("#2563eb");
  });

  it("toggles the two email notifications (FR-DSH-105)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    const sw = await screen.findByRole("switch", { name: /stopped retrying/i });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await user.click(sw);
    await waitFor(async () => expect((await api.getNotificationSettings()).emailOnExhausted).toBe(false));
    expect(screen.getByRole("switch", { name: /about to expire/i })).toHaveAttribute("aria-checked", "true");
  });

  it("deletes test data after typing the business name (FR-DSH-104, BR-DSH-010)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m);
    await user.click(screen.getByRole("button", { name: /delete test data/i }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /delete everything in test mode/i });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/type nimbus/i), "Nimbus");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(async () => expect(await api.listProducts("test", { includeArchived: true })).toHaveLength(0));
    expect(screen.getByRole("link", { name: /email us/i })).toHaveAttribute("href", expect.stringMatching(/^mailto:/));
  });
});
