/**
 * Developers → Events: the log with a type filter, and the detail with the
 * JSON payload and its deliveries. First surface on the split layout.
 * FR-DSH-090, FR-DSH-091; FR-DSH-009 (mobile shows one pane).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventDetail } from "./event-detail";
import { EventsList } from "./events-list";
import { MerchantProvider } from "./merchant-context";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

const push = vi.fn();
let pathname = "/dashboard/developers/events";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSelectedLayoutSegment: () => null,
}));

async function signIn(api: MockDashboardApi): Promise<Merchant> {
  const { devToken } = await api.requestMagicLink("demo@elapse.finance");
  return api.verifyMagicLink(devToken);
}
function mount(api: MockDashboardApi, merchant: Merchant, ui: React.ReactNode) {
  return render(<MerchantProvider value={{ merchant, api, setMerchant: () => {} }}>{ui}</MerchantProvider>);
}

describe("Events", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    pathname = "/dashboard/developers/events";
  });

  it("lists events with type, object id, time, delivery word; filters by type (FR-DSH-090)", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    mount(api, m, <EventsList />);
    const list = await screen.findByRole("list", { name: /^events$/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(5);
    const first = (await api.listEvents("test", {}))[0]!;
    expect(rows[0]).toHaveTextContent(first.type);
    expect(rows[0]).toHaveTextContent(first.objectId);
    expect(rows[0]).toHaveTextContent(/delivered|pending|failed/i);
    await user.selectOptions(screen.getByLabelText(/filter by type/i), "subscription.canceled");
    await waitFor(() => {
      const r = within(screen.getByRole("list", { name: /^events$/i })).getAllByRole("listitem");
      expect(r.every((x) => x.textContent?.includes("subscription.canceled"))).toBe(true);
    });
  });

  it("marks the selected event in the list", async () => {
    const m = await signIn(api);
    const first = (await api.listEvents("test", {}))[0]!;
    pathname = `/dashboard/developers/events/${first.id}`;
    mount(api, m, <EventsList />);
    const list = await screen.findByRole("list", { name: /^events$/i });
    expect(within(list).getByRole("link", { current: "page" })).toHaveTextContent(first.id);
  });

  it("shows the payload as JSON with copy, and the deliveries it produced (FR-DSH-091)", async () => {
    const m = await signIn(api);
    const ev = (await api.listEvents("test", { type: "subscription.canceled" }))[0]!;
    mount(api, m, <EventDetail eventId={ev.id} />);
    expect(await screen.findByRole("heading", { name: ev.type })).toBeInTheDocument();
    const code = screen.getByTestId("event-payload");
    expect(code).toHaveTextContent(`"id": "${ev.id}"`);
    expect(code).toHaveTextContent('"seconds_elapsed"');
    expect(screen.getByRole("button", { name: /copy payload/i })).toBeInTheDocument();
    const deliveries = screen.getByRole("list", { name: /deliveries/i });
    const expected = (await api.getEvent(ev.id)).deliveries;
    expect(within(deliveries).getAllByRole("listitem")).toHaveLength(expected.length);
    for (const d of expected) expect(within(deliveries).getByRole("link", { name: new RegExp(d.endpoint.url) })).toBeInTheDocument();
  });

  it("names a missing event", async () => {
    const m = await signIn(api);
    mount(api, m, <EventDetail eventId="evt_nope" />);
    expect(await screen.findByText(/can't find this event/i)).toBeInTheDocument();
  });
});
