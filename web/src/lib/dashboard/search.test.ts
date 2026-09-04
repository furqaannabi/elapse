/** Top-bar search resolves ids and emails to a page (FR-DSH-005). */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";

describe("resolveSearch (FR-DSH-005)", () => {
  let api: MockDashboardApi;
  beforeEach(async () => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
  });

  it("resolves each id prefix to its detail route", async () => {
    const sub = (await api.listSubscriptions("test", {}))[0]!;
    expect(await api.resolveSearch("test", sub.id)).toBe(`/dashboard/subscriptions/${sub.id}`);
    expect(await api.resolveSearch("test", sub.checkoutSession)).toBe(`/dashboard/subscriptions/${sub.id}`);
    expect(await api.resolveSearch("test", sub.customer.id)).toBe(`/dashboard/customers/${sub.customer.id}`);
    const ev = (await api.listEvents("test", {}))[0]!;
    expect(await api.resolveSearch("test", ev.id)).toBe(`/dashboard/developers/events/${ev.id}`);
    const ep = (await api.listEndpoints("test"))[0]!;
    expect(await api.resolveSearch("test", ep.id)).toBe(`/dashboard/developers/webhooks/${ep.id}`);
    const prod = (await api.listProducts("test", {}))[0]!;
    expect(await api.resolveSearch("test", prod.id)).toBe(`/dashboard/products?highlight=${prod.id}`);
  });

  it("resolves an email to the customer and unknowns to null", async () => {
    const c = (await api.listCustomers("test", {})).find((x) => x.email)!;
    expect(await api.resolveSearch("test", c.email!)).toBe(`/dashboard/customers/${c.id}`);
    expect(await api.resolveSearch("test", "sub_nope")).toBeNull();
    expect(await api.resolveSearch("test", "nobody@example.com")).toBeNull();
  });

  it("does not cross modes", async () => {
    const sub = (await api.listSubscriptions("live", {}))[0]!;
    expect(await api.resolveSearch("test", sub.id)).toBeNull();
  });
});
