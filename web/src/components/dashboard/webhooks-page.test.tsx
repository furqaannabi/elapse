/**
 * Developers → Webhooks: endpoint list and the endpoint detail with the
 * delivery log, delivery drawer, and resend.
 *
 * FR-DSH-080 (list), FR-DSH-081 (add + reveal whsec_ once), FR-DSH-082
 * (edit, disable, roll, send test), FR-DSH-083 (delivery log + filter),
 * FR-DSH-084 (drawer + resend), FR-DSH-085 (disabled notice).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhooksPage } from "./webhooks-page";
import { EndpointDetail } from "./endpoint-detail";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Delivery, Merchant } from "@/lib/dashboard/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/developers/webhooks",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

async function signIn(api: MockDashboardApi, email = "demo@elapse.finance"): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink(email);
  const m = await api.verifyMagicLink(devToken);
  return m.name ? m : api.completeFirstRun({ name: "Acme" });
}

function mount(api: MockDashboardApi, merchant: Merchant, ui: React.ReactNode) {
  return render(
    <MerchantProvider value={{ merchant, api, setMerchant: () => {} }}>
      {ui}
    </MerchantProvider>,
  );
}

describe("WebhooksPage", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    push.mockReset();
  });

  it("lists endpoints with url, events, status word, success rate (FR-DSH-080)", async () => {
    const m = await signIn(api);
    mount(api, m, <WebhooksPage />);
    const list = await screen.findByRole("list", { name: /endpoints/i });
    const eps = await api.listEndpoints("test");
    for (const e of eps) {
      const row = within(list).getByText(e.url).closest("li")!;
      expect(row).toHaveTextContent(e.disabled ? /disabled/i : /enabled/i);
      expect(row).toHaveTextContent(e.events === "*" ? /all events/i : new RegExp(`${e.events.length} event`));
      expect(row).toHaveTextContent(`${Math.round(e.successRate7d * 100)}%`);
    }
  });

  it("adds an endpoint and reveals the signing secret once (FR-DSH-081)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api, "fresh@example.com");
    mount(api, m, <WebhooksPage />);
    await user.click(await screen.findByRole("button", { name: /add endpoint/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/endpoint url/i), "http://acme.example/hooks");
    await user.click(within(dialog).getByRole("button", { name: /^add endpoint$/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/https/i);
    await user.clear(within(dialog).getByLabelText(/endpoint url/i));
    await user.type(within(dialog).getByLabelText(/endpoint url/i), "https://acme.example/hooks");
    await user.click(within(dialog).getByRole("checkbox", { name: /invoice\.settled/i }));
    await user.click(within(dialog).getByRole("button", { name: /^add endpoint$/i }));
    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByTestId("secret-key").textContent).toMatch(/^whsec_/);
    await user.click(within(reveal).getByRole("button", { name: /saved it/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(screen.getByRole("list", { name: /endpoints/i })).getByText("https://acme.example/hooks")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/whsec_[A-Za-z0-9]{10}/);
  });
});

describe("EndpointDetail", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  async function enabledEndpoint() {
    return (await api.listEndpoints("test")).find((e) => !e.disabled)!;
  }

  it("shows the delivery log with status words and attempt counts; filters (FR-DSH-083)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = await enabledEndpoint();
    mount(api, m, <EndpointDetail endpointId={ep.id} />);
    const log = await screen.findByRole("list", { name: /deliveries/i });
    const all = (await api.listDeliveries(ep.id)).data;
    expect(within(log).getAllByRole("listitem").length).toBe(Math.min(all.length, 50));
    await user.selectOptions(screen.getByLabelText(/filter by status/i), "exhausted");
    // The list carries a summary; the drawer must fetch and show every attempt (found 2026-09-06).
    const exhausted = await api.getDelivery((await api.listDeliveries(ep.id, { status: "exhausted" })).data[0]!.id);
    const row = (await screen.findByText(exhausted.event.id)).closest("li")!;
    expect(row).toHaveTextContent(/exhausted/i);
    expect(row).toHaveTextContent(`8 / 8`);
    await waitFor(() => {
      const rows = within(screen.getByRole("list", { name: /deliveries/i })).getAllByRole("listitem");
      expect(rows.every((r) => /exhausted/i.test(r.textContent ?? ""))).toBe(true);
    });
  });

  it("opens a delivery drawer with the signature header, body, response, attempts, and resends (FR-DSH-084)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = await enabledEndpoint();
    mount(api, m, <EndpointDetail endpointId={ep.id} />);
    await screen.findByRole("list", { name: /deliveries/i });
    await user.selectOptions(screen.getByLabelText(/filter by status/i), "exhausted");
    // The list carries a summary; the drawer must fetch and show every attempt (found 2026-09-06).
    const exhausted = await api.getDelivery((await api.listDeliveries(ep.id, { status: "exhausted" })).data[0]!.id);
    const log = screen.getByRole("list", { name: /deliveries/i });
    await user.click(await within(log).findByText(exhausted.event.id));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveTextContent("X-Elapse-Signature");
    expect(drawer).toHaveTextContent(/t=\d+,v1=/);
    expect(drawer).toHaveTextContent(/"type"/);
    expect(within(drawer).getAllByRole("listitem").length).toBeGreaterThanOrEqual(8);
    expect(drawer).toHaveTextContent(`${exhausted.attempts.length} attempts`);
    await user.click(within(drawer).getByRole("button", { name: /^resend$/i }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText(/manual/i)).toBeInTheDocument());
    const after = await api.getDelivery(exhausted.id);
    expect(after.attempts.length).toBe(exhausted.attempts.length + 1);
    // The header counts every attempt made, manual ones included (found 2026-09-06).
    expect(screen.getByRole("dialog")).toHaveTextContent(`${exhausted.attempts.length + 1} attempts`);
  });

  it("a disabled endpoint's deliveries cannot be resent: the button is off and says why (found 2026-09-06)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = await enabledEndpoint();
    await api.updateEndpoint(ep.id, { disabled: true });
    mount(api, m, <EndpointDetail endpointId={ep.id} />);
    const log = await screen.findByRole("list", { name: /deliveries/i });
    const first = (await api.listDeliveries(ep.id)).data[0]!;
    await user.click(await within(log).findByText(first.event.id));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("button", { name: /^resend$/i })).toBeDisabled();
    expect(drawer).toHaveTextContent(/endpoint is disabled/i);
    await expect(api.resendDelivery(first.id)).rejects.toThrow(/disabled/);
  });

  it("sends a test event of a chosen type (FR-DSH-082)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = await enabledEndpoint();
    mount(api, m, <EndpointDetail endpointId={ep.id} />);
    const before = (await api.listDeliveries(ep.id, { limit: 1000 })).data.length;
    await user.click(await screen.findByRole("button", { name: /send test event/i }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/event type/i), "subscription.canceled");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(async () => expect((await api.listDeliveries(ep.id, { limit: 1000 })).data.length).toBe(before + 1));
  });

  it("disables with a notice and rolls the secret with a grace period (FR-DSH-082/085)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = await enabledEndpoint();
    mount(api, m, <EndpointDetail endpointId={ep.id} />);
    await user.click(await screen.findByRole("switch", { name: /enabled/i }));
    expect(await screen.findByRole("status", { name: /disabled/i })).toHaveTextContent(/skipped/i);
    await user.click(screen.getByRole("button", { name: /roll signing secret/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /1 hour/i }));
    await user.click(within(dialog).getByRole("button", { name: /roll secret/i }));
    const reveal = await screen.findByRole("dialog");
    expect(within(reveal).getByTestId("secret-key").textContent).toMatch(/^whsec_/);
  });
});

describe("EndpointDetail · FR-DSH-126 paging", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("shows 50 deliveries, loads more in place, and hides the button on the last page", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const ep = (await api.listEndpoints("test")).find((e) => !e.disabled)!;
    const rows: Delivery[] = Array.from({ length: 120 }, (_, i) => ({
      id: `dlv_big${120 - i}` as const, livemode: false,
      event: { id: `evt_big${120 - i}` as const, type: "invoice.settled", objectId: "inv_big", createdAt: 1_757_000_000_000 - i * 60_000 },
      endpoint: { id: ep.id, url: ep.url }, status: "succeeded", attempt: 1, maxAttempts: 8, attemptsMade: 1, endpointDisabled: false,
      lastResponseCode: 200, nextAttemptAt: null, attempts: [],
    }));
    const big: MockDashboardApi = {
      ...api,
      async listDeliveries(_id, filter = {}) {
        const limit = filter.limit ?? 50;
        const start = filter.startingAfter ? rows.findIndex((r) => r.id === filter.startingAfter) + 1 : 0;
        return { data: rows.slice(start, start + limit), hasMore: start + limit < rows.length };
      },
    };
    mount(big, m, <EndpointDetail endpointId={ep.id} />);
    const list = await screen.findByRole("list", { name: /deliveries/i });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(50));
    expect(screen.getByText(/50 shown · more available/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /deliveries/i })).getAllByRole("listitem")).toHaveLength(100));
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /deliveries/i })).getAllByRole("listitem")).toHaveLength(120));
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  }, 15_000); // renders 120 rows through three rounds of user events: ~1 s locally, past 5 s on a busy CI runner
});
