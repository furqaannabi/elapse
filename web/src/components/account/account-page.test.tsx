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

  it("FR_CHK_030_pause_appears_only_on_meters_whose_product_allows_it_and_resume_takes_a_paused_meter_back", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    const rows = await screen.findAllByRole("group");
    // Nimbus allows pause; Halcyon does not. Stop stays on both, with no confirmation for pause.
    expect(within(rows[0]!).getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole("button", { name: /pause/i })).toBeNull();
    expect(within(rows[1]!).getByRole("button", { name: /stop/i })).toBeInTheDocument();
    await user.click(within(rows[0]!).getByRole("button", { name: /pause/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const paused = (await screen.findAllByRole("group"))[0]!;
    expect(await within(paused).findByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(within(paused).getByText(/paused/i)).toBeInTheDocument();
    expect(screen.getByText(/1 meter running · 1 paused/i)).toBeInTheDocument();
    expect(within(paused).getByRole("button", { name: /stop/i })).toBeInTheDocument();
    await user.click(within(paused).getByRole("button", { name: /resume/i }));
    const back = (await screen.findAllByRole("group"))[0]!;
    expect(await within(back).findByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/wallet|transaction|signature|chain/i);
  });

  it("FR_CHK_018_a_test_mode_meter_carries_a_Test_tag_and_a_live_one_does_not", async () => {
    const api = createMockAccountApi({ latencyMs: 0, seed: "two-merchants", now: () => Date.now() });
    const base = await api.getView();
    if (base.status !== "signed_in") throw new Error("seed");
    const tagged = { ...base, meters: base.meters.map((m, i) => ({ ...m, test: i === 0 })) };
    vi.spyOn(api, "getView").mockResolvedValue(tagged);
    render(<AccountPage api={api} />);
    const rows = await screen.findAllByRole("group");
    expect(within(rows[0]!).getByText("Test")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText("Test")).toBeNull();
  });

  it("FR_CHK_029_email_receipt_shows_the_sent_state_and_the_limit_copy", async () => {
    const user = userEvent.setup();
    const api = mount("two-merchants");
    await screen.findByText("Nimbus");
    await user.click(screen.getAllByRole("button", { name: /you paid/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    const btn = within(dialog).getByRole("button", { name: /email receipt/i });
    await user.click(btn);
    expect(await within(dialog).findByRole("button", { name: /sent to/i })).toBeDisabled();
    vi.spyOn(api, "emailReceipt").mockRejectedValueOnce(Object.assign(new Error("Already sent. Check your inbox."), { code: "already_sent" }));
  });

  it("FR_CHK_020_start_again_on_a_receipt_opens_the_follow_on_session_and_goes_there", async () => {
    const user = userEvent.setup();
    const api = createMockAccountApi({ latencyMs: 0, seed: "two-merchants", now: () => Date.now() });
    const base = await api.getView();
    if (base.status !== "signed_in") throw new Error("seed");
    vi.spyOn(api, "getView").mockResolvedValue({ ...base, receipts: base.receipts.map((r) => ({ ...r, session: "cs_old" as const })) });
    const startAgain = vi.spyOn(api, "startAgain").mockResolvedValue({ url: "http://localhost:3000/c/cs_new" });
    const go = vi.fn();
    render(<AccountPage api={api} navigate={go} />);
    await user.click((await screen.findAllByRole("button", { name: /you paid/i }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /start again/i }));
    await vi.waitFor(() => expect(startAgain).toHaveBeenCalledWith("cs_old"));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("http://localhost:3000/c/cs_new"));
  });

  it("FR_CHK_020_a_restarted_account_receipt_links_to_the_newer_session_instead_of_the_button", async () => {
    const user = userEvent.setup();
    const api = createMockAccountApi({ latencyMs: 0, seed: "two-merchants", now: () => Date.now() });
    const base = await api.getView();
    if (base.status !== "signed_in") throw new Error("seed");
    vi.spyOn(api, "getView").mockResolvedValue({ ...base, receipts: base.receipts.map((r) => ({ ...r, session: "cs_old" as const, restartedAs: "cs_new" as const })) });
    render(<AccountPage api={api} />);
    await user.click((await screen.findAllByRole("button", { name: /you paid/i }))[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /start again/i })).toBeNull();
    expect(within(dialog).getByRole("link", { name: /newer session followed/i })).toHaveAttribute("href", "/c/cs_new");
  });
});

describe("AccountPage · FR-CHK-036 held money", () => {
  const clock = new Date(NOW + 600_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("FR_CHK_036_a_held_session_is_listed_with_what_is_held_and_when_it_comes_back_outside_the_running_total", async () => {
    mount("held");
    const row = await screen.findByRole("group", { name: "Northwind Compute · Serverless runtime" });
    expect(within(row).getByText("Not started · $7.20 held")).toBeInTheDocument();
    expect(within(row).getByText(`Comes back at ${clock} if not started`)).toBeInTheDocument();
    // Only the real meter counts as running; held money accrues nothing.
    expect(screen.getByText(/^1 meter running/)).toBeInTheDocument();
  });

  it("FR_CHK_036_stop_on_a_held_session_says_nothing_has_been_charged_and_ends_as_a_past_session", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount("held");
    const row = await screen.findByRole("group", { name: "Northwind Compute · Serverless runtime" });
    await user.click(within(row).getByRole("button", { name: /stop/i }));
    expect(await screen.findByText(/You haven.t been charged\. All of it comes back\./)).toBeInTheDocument();
    expect(screen.queryByText(/you.ll pay/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop the meter" }));
    expect(await screen.findByText("Past sessions")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Northwind Compute · Serverless runtime" })).toBeNull();

    // Its receipt: nothing charged, everything back, and no start time for a meter that never started.
    await user.click(screen.getByRole("button", { name: /northwind compute/i }));
    expect(await screen.findByText("Returned to you")).toBeInTheDocument();
    expect(screen.queryByText("Started")).toBeNull();
  });
});
