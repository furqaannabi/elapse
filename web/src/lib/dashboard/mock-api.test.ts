/**
 * The in-memory dashboard API used until `api/` exists.
 *
 * FR-DSH-010 (magic link request), FR-DSH-011 (verify: valid, expired,
 * used), FR-DSH-012 (session required), FR-DSH-013 (first-run capture),
 * FR-DSH-014 (sign out), FR-DSH-110 (seeded merchants).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, DashboardApiError, resetMockDashboardApi } from "./mock-api";

const NOW = 1_756_800_000_000;

describe("mock dashboard api — auth", () => {
  let api: ReturnType<typeof createMockDashboardApi>;
  let now = NOW;
  beforeEach(() => {
    now = NOW;
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ now: () => now, latencyMs: 0 });
  });

  it("has no session until a link is verified (FR-DSH-012)", async () => {
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("signs in a seeded merchant from a requested link (FR-DSH-010/011)", async () => {
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    expect(devToken).toMatch(/^tok_/);
    const merchant = await api.verifyMagicLink(devToken);
    expect(merchant.email).toBe("demo@elapse.dev");
    expect(merchant.name).toBe("Nimbus");
    await expect(api.me()).resolves.toMatchObject({ id: merchant.id });
  });

  it("creates a merchant for an unknown email, needing first-run (FR-DSH-010/013)", async () => {
    const { devToken } = await api.requestMagicLink("new@example.com");
    const merchant = await api.verifyMagicLink(devToken);
    expect(merchant.email).toBe("new@example.com");
    expect(merchant.name).toBeNull();
    const done = await api.completeFirstRun({ name: "Acme GPU" });
    expect(done.name).toBe("Acme GPU");
    expect(done.payoutAddress).toBeNull();
  });

  it("rejects an expired link (FR-DSH-011)", async () => {
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    now += 16 * 60_000;
    await expect(api.verifyMagicLink(devToken)).rejects.toMatchObject({ code: "link_expired" });
  });

  it("rejects a link that was already used (FR-DSH-011)", async () => {
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
    await expect(api.verifyMagicLink(devToken)).rejects.toMatchObject({ code: "link_used" });
  });

  it("rejects an unknown token", async () => {
    await expect(api.verifyMagicLink("tok_nope")).rejects.toBeInstanceOf(DashboardApiError);
  });

  it("keeps the session across a reload of the api (cookie stand-in)", async () => {
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
    const again = createMockDashboardApi({ now: () => now, latencyMs: 0 });
    await expect(again.me()).resolves.toMatchObject({ email: "demo@elapse.dev" });
  });

  it("keeps a merchant created through the link, and their data, across a reload (FR-DSH-012)", async () => {
    const { devToken } = await api.requestMagicLink("keep@example.com");
    await api.verifyMagicLink(devToken);
    await api.completeFirstRun({ name: "Keep Co" });
    await api.createProduct("test", { name: "Seat", rateUsdPerSecond: "0.001", description: null, allowPause: false });
    // A full reload drops module state but keeps localStorage.
    resetMockDashboardApi();
    const again = createMockDashboardApi({ now: () => now, latencyMs: 0 });
    const me = await again.me();
    expect(me.name).toBe("Keep Co");
    expect((await again.listProducts("test", {})).map((p) => p.name)).toEqual(["Seat"]);
  });

  it("signs out (FR-DSH-014)", async () => {
    const { devToken } = await api.requestMagicLink("demo@elapse.dev");
    await api.verifyMagicLink(devToken);
    await api.signOut();
    await expect(api.me()).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
