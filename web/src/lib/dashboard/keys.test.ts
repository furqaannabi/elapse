/**
 * API keys in the mock: list per mode, create with reveal-once, roll with a
 * grace period, revoke. FR-DSH-070…074, BR-DSH-001.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";

const NOW = 1_756_800_000_000;
const HOUR = 3_600_000;

describe("mock dashboard api — keys", () => {
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

  it("lists one publishable key and named secret keys per mode (FR-DSH-070/074)", async () => {
    const test = await api.listKeys("test");
    const live = await api.listKeys("live");
    expect(test.publishable).toMatch(/^pk_test_/);
    expect(live.publishable).toMatch(/^pk_live_/);
    expect(test.secret.length).toBeGreaterThan(0);
    for (const k of test.secret) {
      expect(k.prefix).toMatch(/^sk_test_/);
      expect(k.last4).toHaveLength(4);
      expect(k).not.toHaveProperty("secret");
    }
  });

  it("creates a secret key and reveals it exactly once (FR-DSH-071, BR-DSH-001)", async () => {
    const created = await api.createKey("test", "CI runner");
    expect(created.secret).toMatch(/^sk_test_[A-Za-z0-9]{24,}$/);
    expect(created.key.name).toBe("CI runner");
    expect(created.key.last4).toBe(created.secret.slice(-4));
    const { secret } = await api.listKeys("test");
    const row = secret.find((k) => k.id === created.key.id)!;
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(created.secret);
  });

  it("rolls a key with a grace period; the old one shows an expiry (FR-DSH-072)", async () => {
    const { key } = await api.createKey("test", "Server");
    const rolled = await api.rollKey(key.id, { graceMs: 24 * HOUR });
    expect(rolled.secret).toMatch(/^sk_test_/);
    expect(rolled.key.name).toBe("Server");
    const { secret } = await api.listKeys("test");
    const old = secret.find((k) => k.id === key.id)!;
    expect(old.expiresAt).toBe(NOW + 24 * HOUR);
    expect(old.status).toBe("expiring");
    now += 25 * HOUR;
    const later = (await api.listKeys("test")).secret.find((k) => k.id === key.id)!;
    expect(later.status).toBe("expired");
  });

  it("rolls with grace 0 expiring the old key immediately", async () => {
    const { key } = await api.createKey("test", "Server");
    await api.rollKey(key.id, { graceMs: 0 });
    const old = (await api.listKeys("test")).secret.find((k) => k.id === key.id)!;
    expect(old.status).toBe("expired");
  });

  it("revokes a key and keeps the row (FR-DSH-073)", async () => {
    const { key } = await api.createKey("test", "Temp");
    await api.revokeKey(key.id);
    const row = (await api.listKeys("test")).secret.find((k) => k.id === key.id)!;
    expect(row.status).toBe("revoked");
    expect(row.revokedAt).toBe(NOW);
  });

  it("makes the checklist see a secret key (FR-DSH-020)", async () => {
    const { devToken } = await api.requestMagicLink("fresh@example.com");
    await api.verifyMagicLink(devToken);
    await api.completeFirstRun({ name: "Fresh" });
    expect((await api.checklist("test")).hasSecretKey).toBe(false);
    await api.createKey("test", "First");
    expect((await api.checklist("test")).hasSecretKey).toBe(true);
  });

  it("is idempotent on create with the same idempotency key (FR-DSH-112)", async () => {
    const a = await api.createKey("test", "Once", { idempotencyKey: "idem_1" });
    const b = await api.createKey("test", "Once", { idempotencyKey: "idem_1" });
    expect(b.key.id).toBe(a.key.id);
    expect(b.secret).toBe(a.secret);
    const names = (await api.listKeys("test")).secret.filter((k) => k.name === "Once");
    expect(names).toHaveLength(1);
  });
});
