/**
 * Subscriptions in the mock: list with filters, detail with timeline and
 * settlements, merchant cancel through the contract path.
 * FR-DSH-040…043; BR-DSH-008.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";
import { parseRate, settledNano, formatUsd } from "@/lib/meter/math";

const NOW = 1_756_800_000_000;

describe("mock dashboard api — subscriptions", () => {
  let api: MockDashboardApi;
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ now: () => now, latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    await api.verifyMagicLink(devToken);
  });

  it("lists subscriptions newest first with status and product filters (FR-DSH-040)", async () => {
    const all = await api.listSubscriptions("test", {});
    expect(all.length).toBeGreaterThan(10);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
    const active = await api.listSubscriptions("test", { status: "active" });
    expect(active.every((s) => s.status === "active")).toBe(true);
    const product = all[0]!.product.id;
    const byProduct = await api.listSubscriptions("test", { product });
    expect(byProduct.every((s) => s.product.id === product)).toBe(true);
  });

  it("returns a detail with timeline events and settlements (FR-DSH-041/042)", async () => {
    const canceled = (await api.listSubscriptions("test", { status: "canceled" }))[0]!;
    const d = await api.getSubscription(canceled.id);
    expect(d.subscription.id).toBe(canceled.id);
    expect(d.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(["subscription.created", "subscription.canceled"]));
    for (let i = 1; i < d.timeline.length; i++) expect(d.timeline[i - 1]!.createdAt).toBeLessThanOrEqual(d.timeline[i]!.createdAt);
    for (const inv of d.invoices) {
      expect(inv.subscription).toBe(canceled.id);
      expect(inv.txId).toMatch(/^0x/);
    }
  });

  it("merchant cancel settles whole seconds and refunds the rest (FR-DSH-043, BR-DSH-008)", async () => {
    const active = (await api.listSubscriptions("test", { status: "active" }))[0]!;
    const before = await api.getSubscription(active.id);
    now += 30_000;
    const { subscription, receipt } = await api.cancelSubscription(active.id, { idempotencyKey: "c1" });
    expect(subscription.status).toBe("canceled");
    expect(subscription.canceledAt).toBe(now);
    const rate = parseRate(active.rateUsdPerSecond);
    const seconds = Math.floor((now - active.startedAt!) / 1000);
    expect(receipt.secondsElapsed).toBe(seconds);
    expect(receipt.amountSettledUsd).toBe(formatUsd(settledNano(rate, seconds), 3, { symbol: false }));
    const funded = parseRate(active.fundedUsd.replace(/,/g, ""));
    expect(parseRate(receipt.amountSettledUsd) + parseRate(receipt.refundedUsd)).toBe(funded);
    const after = await api.getSubscription(active.id);
    expect(after.invoices.length).toBeGreaterThanOrEqual(before.invoices.length);
    expect(after.timeline.some((e) => e.type === "subscription.canceled")).toBe(true);
    const again = await api.cancelSubscription(active.id, { idempotencyKey: "c1" });
    expect(again.receipt).toEqual(receipt);
  });

  it("refuses to cancel a canceled meter", async () => {
    const canceled = (await api.listSubscriptions("test", { status: "canceled" }))[0]!;
    await expect(api.cancelSubscription(canceled.id)).rejects.toMatchObject({ code: "invalid_state" });
  });
});
