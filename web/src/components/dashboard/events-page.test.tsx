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
import type { Event, Merchant } from "@/lib/dashboard/types";

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
    const first = (await api.listEvents("test", {})).data[0]!;
    expect(rows[0]).toHaveTextContent(first.type);
    expect(rows[0]).toHaveTextContent(first.objectId);
    expect(rows[0]).toHaveTextContent(/delivered|pending|failed/i);
    await user.selectOptions(screen.getByLabelText(/filter by type/i), "subscription.canceled");
    await waitFor(() => {
      const r = within(screen.getByRole("list", { name: /^events$/i })).getAllByRole("listitem");
      expect(r.every((x) => x.textContent?.includes("subscription.canceled"))).toBe(true);
    });
  });

  it("shows product · customer under each row, with the amount on invoice rows; a test event stays id-only (FR-DSH-093)", async () => {
    const m = await signIn(api);
    // A test event resolves no meter, so its row must stay the old id-only shape.
    const ep = (await api.listEndpoints("test"))[0]!;
    await api.sendTestEvent(ep.id, "subscription.canceled");
    mount(api, m, <EventsList />);
    const list = await screen.findByRole("list", { name: /^events$/i });
    const events = (await api.listEvents("test", {})).data;
    const test = events[0]!;
    expect(test.context).toBeNull();
    const withEmail = events.find((e) => e.context?.customerEmail && e.type === "subscription.created")!;
    const invoice = events.find((e) => e.type === "invoice.settled" && e.context?.customerEmail)!;
    const row = (e: Event) => within(list).getByRole("link", { name: new RegExp(e.id) });
    expect(row(withEmail)).toHaveTextContent(`${withEmail.context!.productName} · ${withEmail.context!.customerEmail}`);
    expect(row(invoice)).toHaveTextContent(`${invoice.context!.productName} · ${invoice.context!.customerEmail} · $${invoice.context!.amountSettled}`);
    expect(row(test)).toHaveTextContent(`${test.id} · ${test.objectId}`);
    expect(row(test).textContent).not.toContain(" · $");
  });

  it("marks the selected event in the list", async () => {
    const m = await signIn(api);
    const first = (await api.listEvents("test", {})).data[0]!;
    pathname = `/dashboard/developers/events/${first.id}`;
    mount(api, m, <EventsList />);
    const list = await screen.findByRole("list", { name: /^events$/i });
    expect(within(list).getByRole("link", { current: "page" })).toHaveTextContent(first.id);
  });

  it("shows the payload as JSON with copy, and the deliveries it produced (FR-DSH-091)", async () => {
    const m = await signIn(api);
    const ev = (await api.listEvents("test", { type: "subscription.canceled" })).data[0]!;
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

  it("the detail shows the context line under the title (FR-DSH-093)", async () => {
    const m = await signIn(api);
    const ev = (await api.listEvents("test", { type: "invoice.settled" })).data.find((e) => e.context?.customerEmail)!;
    mount(api, m, <EventDetail eventId={ev.id} />);
    await screen.findByRole("heading", { name: ev.type });
    expect(screen.getByText(`${ev.context!.productName} · ${ev.context!.customerEmail} · $${ev.context!.amountSettled}`)).toBeInTheDocument();
  });

  it("names a missing event", async () => {
    const m = await signIn(api);
    mount(api, m, <EventDetail eventId="evt_nope" />);
    expect(await screen.findByText(/can't find this event/i)).toBeInTheDocument();
  });
});

describe("EventsList · FR-DSH-126 paging", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  it("shows 50 events, loads the next page in place, and hides the button on the last page", async () => {
    const user = userEvent.setup();
    const m = await signIn(api);
    const rows: Event[] = Array.from({ length: 120 }, (_, i) => ({
      id: `evt_big${120 - i}` as const, livemode: false, type: "invoice.settled", objectId: "inv_big", createdAt: 1_757_000_000_000 - i * 60_000,
      pendingWebhooks: 0, deliveryState: "delivered", payload: {},
    }));
    const big: MockDashboardApi = {
      ...api,
      async listEvents(_mode, filter) {
        const limit = filter.limit ?? 50;
        const start = filter.startingAfter ? rows.findIndex((r) => r.id === filter.startingAfter) + 1 : 0;
        return { data: rows.slice(start, start + limit), hasMore: start + limit < rows.length };
      },
    };
    mount(big, m, <EventsList />);
    const list = await screen.findByRole("list", { name: /events/i });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(50));
    expect(screen.getByText(/50 shown · more available/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /events/i })).getAllByRole("listitem")).toHaveLength(100));
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /events/i })).getAllByRole("listitem")).toHaveLength(120));
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});

describe("FR-DSH-090/091 an event nobody received says so", () => {
  let api: MockDashboardApi;
  beforeEach(() => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
  });

  const notSent: Event = {
    id: "evt_nobody", livemode: false, type: "subscription.created", objectId: "sub_1",
    createdAt: 1_757_000_000_000, pendingWebhooks: 0, deliveryState: "not_sent", payload: { id: "sub_1" },
  };

  it("reads Not sent in the log, muted rather than dressed as a failure (FR-DSH-090)", async () => {
    // This is the page a merchant opens because a webhook did not arrive. Until FR-API-146 it told
    // them the event was delivered. Nothing failed either — the commonest reason to see this is a
    // merchant who has not configured an endpoint yet.
    const m = await signIn(api);
    const one: MockDashboardApi = { ...api, async listEvents() { return { data: [notSent], hasMore: false }; } };
    mount(one, m, <EventsList />);
    const word = await screen.findByText("Not sent");
    expect(word.className).not.toMatch(/destructive/);
  });

  it("explains it on the detail, without guessing which endpoint was missing (FR-DSH-091)", async () => {
    const m = await signIn(api);
    const one: MockDashboardApi = {
      ...api,
      async getEvent() { return { event: notSent, deliveries: [] }; },
    };
    mount(one, m, <EventDetail eventId="evt_nobody" />);
    expect(await screen.findByText(/No endpoint was listening when this event was created/i)).toBeInTheDocument();
    expect(screen.getByText(/elapse listen/)).toBeInTheDocument();
  });

  it("says nothing of the sort for an event that was delivered", async () => {
    const m = await signIn(api);
    const ev = (await api.listEvents("test", { type: "subscription.canceled" })).data[0]!;
    mount(api, m, <EventDetail eventId={ev.id} />);
    await screen.findByRole("heading", { name: ev.type });
    expect(screen.queryByText(/No endpoint was listening/i)).toBeNull();
  });
});
