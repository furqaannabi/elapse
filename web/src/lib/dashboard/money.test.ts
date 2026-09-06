/**
 * Customers, invoices, ledger, balance, settings, notifications, activity
 * in the mock. FR-DSH-050/051, 060–062, 100–105, 120–125, 130–133, 140–142.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";
import { parseRate } from "@/lib/meter/math";

const NOW = 1_756_800_000_000;
const usd = (v: string) => parseRate(v.replace(/,/g, ""));

describe("mock dashboard api — customers, invoices, ledger", () => {
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

  it("lists customers with totals and searches by email (FR-DSH-050)", async () => {
    const all = await api.listCustomers("test", {});
    expect(all.length).toBeGreaterThan(3);
    const withEmail = all.find((c) => c.email)!;
    const found = await api.listCustomers("test", { search: withEmail.email!.slice(0, 4) });
    expect(found.some((c) => c.id === withEmail.id)).toBe(true);
    const d = await api.getCustomer(withEmail.id);
    expect(d.customer.id).toBe(withEmail.id);
    expect(d.subscriptions.every((s) => s.customer.id === withEmail.id)).toBe(true);
    expect(Array.isArray(d.events)).toBe(true);
  });

  it("lists invoices with gross/fee/net, filters by range and subscription (FR-DSH-060)", async () => {
    const all = await api.listInvoices("test", {});
    expect(all.length).toBeGreaterThan(5);
    for (const inv of all) expect(usd(inv.grossUsd) - usd(inv.feeUsd)).toBe(usd(inv.netUsd));
    const sub = all[0]!.subscription;
    const bySub = await api.listInvoices("test", { subscription: sub });
    expect(bySub.every((i) => i.subscription === sub)).toBe(true);
    const recent = await api.listInvoices("test", { since: now - 3_600_000 });
    expect(recent.every((i) => i.settledAt >= now - 3_600_000)).toBe(true);
  });

  it("ledger has deposit, settlement, fee, refund rows that reconcile with invoices (FR-DSH-122)", async () => {
    const ledger = await api.listLedger("test", {});
    const kinds = new Set(ledger.map((l) => l.kind));
    expect([...kinds].sort()).toEqual(["deposit", "fee", "refund", "settlement"]);
    for (let i = 1; i < ledger.length; i++) expect(ledger[i - 1]!.blockTime).toBeGreaterThanOrEqual(ledger[i]!.blockTime);
    const invoices = await api.listInvoices("test", {});
    const settlementTotal = ledger.filter((l) => l.kind === "settlement" && !l.reversedBy).reduce((a, l) => a + usd(l.amountUsd), 0n);
    const grossTotal = invoices.reduce((a, i) => a + usd(i.grossUsd), 0n);
    expect(settlementTotal).toBe(grossTotal);
    const onlyFees = await api.listLedger("test", { kind: "fee" });
    expect(onlyFees.every((l) => l.kind === "fee")).toBe(true);
    for (const l of ledger) expect(l.txId).toMatch(/^0x/);
  });

  it("balance reports the payout address and settled-this-month net (FR-DSH-120)", async () => {
    const b = await api.getBalance("test");
    expect(b.payoutAddress).toMatch(/^0x/);
    expect(usd(b.ausdUsd)).toBeGreaterThan(0n);
    expect(b.asOf).toBe(now);
  });
});

describe("mock dashboard api — settings, notifications, activity", () => {
  let api: MockDashboardApi;
  beforeEach(async () => {
    localStorage.clear();
    resetMockDashboardApi();
    api = createMockDashboardApi({ latencyMs: 0 });
    const { devToken } = await api.requestMagicLink("demo@elapse.finance");
    await api.verifyMagicLink(devToken);
  });

  it("updates profile, branding, and notification switches (FR-DSH-100/103/105)", async () => {
    const m = await api.updateMerchant({ name: "Nimbus Cloud", supportEmail: "care@nimbus.example", branding: { name: "Nimbus Cloud", accent: "#3b82f6" } });
    expect(m.name).toBe("Nimbus Cloud");
    expect(m.branding.accent).toBe("#3b82f6");
    const n = await api.updateNotificationSettings({ emailOnExhausted: false });
    expect(n.emailOnExhausted).toBe(false);
    expect(n.emailOnExpiring).toBe(true);
  });

  it("changes the payout address only when re-typed correctly and logs it (FR-DSH-101, FR-DSH-140)", async () => {
    await expect(api.changePayoutAddress({ address: "0xabc", confirm: "0xabd" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.changePayoutAddress({ address: "nope", confirm: "nope" })).rejects.toMatchObject({ code: "invalid_input" });
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const m = await api.changePayoutAddress({ address: addr, confirm: addr });
    expect(m.payoutAddress).toBe(addr);
    const log = await api.listActivity({});
    expect(log[0]!.action).toBe("payout_address.changed");
    expect(log[0]!.actor).toBe("demo@elapse.finance");
    expect(JSON.stringify(log)).not.toMatch(/sk_test_[A-Za-z0-9]{8}/);
  });

  it("records key and endpoint actions in the activity log (FR-DSH-140/142)", async () => {
    const { key, secret } = await api.createKey("test", "Logged");
    await api.revokeKey(key.id);
    const log = await api.listActivity({ action: "key.revoked" });
    expect(log[0]!.target).toBe(key.id);
    expect(JSON.stringify(await api.listActivity({}))).not.toContain(secret);
  });

  it("lists notifications, unread counts per mode, mark all read (FR-DSH-130/133)", async () => {
    const list = await api.listNotifications("test");
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((n) => n.kind === "endpoint_exhausted" || n.kind === "payment_failed")).toBe(true);
    const unread = list.filter((n) => !n.readAt).length;
    expect(unread).toBeGreaterThan(0);
    await api.markNotificationsRead("test");
    expect((await api.listNotifications("test")).every((n) => n.readAt)).toBe(true);
  });

  it("deletes test data after the business name is typed (FR-DSH-104)", async () => {
    await expect(api.deleteTestData({ confirmName: "Wrong" })).rejects.toMatchObject({ code: "invalid_input" });
    await api.deleteTestData({ confirmName: "Nimbus" });
    expect(await api.listProducts("test", { includeArchived: true })).toHaveLength(0);
    expect((await api.listProducts("live", { includeArchived: true })).length).toBeGreaterThan(0);
  });
});
