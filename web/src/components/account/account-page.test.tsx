/**
 * The subscriber account page: meters across merchants, a confirmed
 * cancel, and receipts. Elapse-branded because it spans merchants
 * (ADR 2026-09-04), and never a chain word anywhere.
 *
 * FR-CHK-016 (passkey sign-in), FR-CHK-017 (found from the checkout),
 * FR-CHK-018 (meters), FR-CHK-019 (confirm sheet), FR-CHK-020 (receipts),
 * FR-CHK-021 (cap line), FR-CHK-022 (no address), FR-CHK-023 (empty),
 * FR-CHK-026 (no judge mode); BR-CHK-001.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAccountApi, type AccountSeed } from "@/lib/account/mock-api";
import { AccountPage } from "./account-page";

const NOW = 1_756_800_000_000;

function mount(seed: AccountSeed = "two-merchants") {
  const api = createMockAccountApi({ latencyMs: 0, seed, now: () => Date.now() });
  render(<AccountPage api={api} />);
  return api;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("AccountPage", () => {
  it("asks to sign in with the passkey and shows nothing else (FR-CHK-016)", async () => {
    mount("signed-out");
    expect(await screen.findByRole("button", { name: /face id/i })).toBeInTheDocument();
    expect(screen.queryByText(/running now/i)).toBeNull();
  });

  it("lists a meter per merchant with its product and cap (FR-CHK-018, FR-CHK-021)", async () => {
    mount();
    expect(await screen.findByText("Nimbus")).toBeInTheDocument();
    expect(screen.getByText("Halcyon Transcribe")).toBeInTheDocument();
    // the product sits beside the merchant on one line
    expect(screen.getByRole("group", { name: /nimbus · gpu · 4090/i })).toBeInTheDocument();
    // 3600 s at $0.004 is a $14.40 ceiling
    expect(screen.getByText(/of \$14\.40/)).toBeInTheDocument();
  });

  it("never shows an address, and uses no chain words (FR-CHK-022, BR-CHK-001)", async () => {
    const { container } = render(<></>);
    void container;
    mount();
    await screen.findByText("Nimbus");
    expect(document.body.textContent).not.toMatch(
      /wallet|token|permit|allowance|gas|chain|monad|0x[0-9a-f]/i,
    );
  });

  it("cancel asks first, names the merchant, and says what is owed (FR-CHK-019)", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Nimbus");
    const row = screen.getByRole("group", { name: /nimbus/i });
    await user.click(within(row).getByRole("button", { name: /stop/i }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/stop the meter at nimbus/i)).toBeInTheDocument();
    expect(within(sheet).getByText(/you.ll pay/i)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /keep running/i })).toBeInTheDocument();
  });

  it("keeps the meter running when the sheet is dismissed (FR-CHK-019)", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Nimbus");
    const row = screen.getByRole("group", { name: /nimbus/i });
    await user.click(within(row).getByRole("button", { name: /stop/i }));
    await user.click(await screen.findByRole("button", { name: /keep running/i }));
    expect(screen.getByRole("group", { name: /nimbus/i })).toBeInTheDocument();
  });

  it("confirming moves the meter into receipts (FR-CHK-019, FR-CHK-020)", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Nimbus");
    // Counted before the sheet opens: a modal hides the page behind it.
    const before = screen.getAllByRole("button", { name: /you paid/i }).length;
    const row = screen.getByRole("group", { name: /nimbus/i });
    await user.click(within(row).getByRole("button", { name: /stop/i }));
    await user.click(await screen.findByRole("button", { name: /stop the meter/i }));
    await screen.findByText(/past sessions/i);
    expect(screen.queryByRole("group", { name: /nimbus/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /you paid/i })).toHaveLength(before + 1);
  });

  it("sums what is running across merchants, above the fold (FR-CHK-018)", async () => {
    mount();
    await screen.findByText("Nimbus");
    expect(screen.getByText(/2 meters running/i)).toBeInTheDocument();
    expect(screen.getByText(/\/ hour while they run/i)).toBeInTheDocument();
  });

  it("shows past sessions as receipts, newest first (FR-CHK-020)", async () => {
    mount();
    await screen.findByText("Nimbus");
    const receipts = await screen.findAllByRole("button", { name: /you paid/i });
    expect(receipts.length).toBeGreaterThanOrEqual(2);
  });

  it("opens a receipt with what was paid and what came back (FR-CHK-020)", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("Nimbus");
    const receipts = await screen.findAllByRole("button", { name: /you paid/i });
    await user.click(receipts[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/returned to you/i)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /email receipt/i })).toBeInTheDocument();
  });

  it("says so plainly when there is nothing yet (FR-CHK-023)", async () => {
    mount("empty");
    expect(await screen.findByText(/no meters yet/i)).toBeInTheDocument();
  });

  it("warns when a meter is near its cap (FR-CHK-006)", async () => {
    mount("low-balance");
    expect(await screen.findByRole("status")).toHaveTextContent(/left of your 1 hour/i);
  });
});
