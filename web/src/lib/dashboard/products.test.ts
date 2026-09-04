/**
 * Products in the mock: list, create, update, archive/unarchive, and the
 * "Copy Checkout URL" session. FR-DSH-030…033, FR-DSH-112.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";

describe("mock dashboard api — products", () => {
  let api: MockDashboardApi;
  beforeEach(async () => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
  });

  it("lists products with rate and active subscription counts (FR-DSH-030)", async () => {
    const all = await api.listProducts("test", { includeArchived: true });
    const active = await api.listProducts("test", {});
    expect(all.length).toBeGreaterThan(active.length);
    expect(active.every((p) => p.status === "active")).toBe(true);
    const gpu = all.find((p) => p.name === "GPU · 4090")!;
    expect(gpu.rateUsdPerSecond).toBe("0.004");
    expect(gpu.activeSubscriptions).toBeGreaterThanOrEqual(0);
  });

  it("creates a product from a decimal rate string, never a float (FR-DSH-031)", async () => {
    const p = await api.createProduct("test", { name: "Render minute", rateUsdPerSecond: "0.0015", description: "x", allowPause: false }, { idempotencyKey: "p1" });
    expect(p.id).toMatch(/^prod_/);
    expect(p.rateUsdPerSecond).toBe("0.0015");
    expect(p.status).toBe("active");
    const again = await api.createProduct("test", { name: "Render minute", rateUsdPerSecond: "0.0015", description: "x", allowPause: false }, { idempotencyKey: "p1" });
    expect(again.id).toBe(p.id);
    await expect(api.createProduct("test", { name: "", rateUsdPerSecond: "0.001", description: null, allowPause: false })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.createProduct("test", { name: "Bad", rateUsdPerSecond: "0", description: null, allowPause: false })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.createProduct("test", { name: "Bad", rateUsdPerSecond: "1e-3", description: null, allowPause: false })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.createProduct("test", { name: "Bad", rateUsdPerSecond: "0.0000000001", description: null, allowPause: false })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("updates and archives; archived products cannot start new sessions (FR-DSH-033)", async () => {
    const p = await api.createProduct("test", { name: "Seat", rateUsdPerSecond: "0.001", description: null, allowPause: true });
    const u = await api.updateProduct(p.id, { name: "Seat (team)", allowPause: false });
    expect(u.name).toBe("Seat (team)");
    expect(u.allowPause).toBe(false);
    const a = await api.updateProduct(p.id, { status: "archived" });
    expect(a.status).toBe("archived");
    await expect(api.createCheckoutLink(p.id)).rejects.toMatchObject({ code: "invalid_state" });
    const back = await api.updateProduct(p.id, { status: "active" });
    expect(back.status).toBe("active");
  });

  it("creates a checkout link for a product in the product's mode (FR-DSH-032)", async () => {
    const [p] = await api.listProducts("test", {});
    const link = await api.createCheckoutLink(p!.id, { idempotencyKey: "cl1" });
    expect(link.id).toMatch(/^cs_/);
    expect(link.url).toMatch(new RegExp(`/c/${link.id}$`));
    const again = await api.createCheckoutLink(p!.id, { idempotencyKey: "cl1" });
    expect(again.id).toBe(link.id);
  });

  it("makes the checklist see a product (FR-DSH-020)", async () => {
    const { devToken } = await api.requestMagicLink("fresh@example.com");
    await api.verifyMagicLink(devToken);
    await api.completeFirstRun({ name: "Fresh" });
    expect((await api.checklist("test")).hasProduct).toBe(false);
    await api.createProduct("test", { name: "A", rateUsdPerSecond: "0.002", description: null, allowPause: false });
    expect((await api.checklist("test")).hasProduct).toBe(true);
  });
});
