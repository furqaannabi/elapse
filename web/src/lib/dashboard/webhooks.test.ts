/**
 * Webhook endpoints, deliveries, and events in the mock.
 * FR-DSH-080…085 (endpoints, secret reveal-once, roll, test event,
 * delivery log, resend, disabled), FR-DSH-090/091 (events).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockDashboardApi, resetMockDashboardApi, type MockDashboardApi } from "./mock-api";

const NOW = 1_756_800_000_000;

describe("mock dashboard api — webhooks", () => {
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

  it("lists endpoints with a 7-day success rate and never the secret (FR-DSH-080)", async () => {
    const eps = await api.listEndpoints("test");
    expect(eps.length).toBeGreaterThan(0);
    for (const e of eps) {
      expect(e.url).toMatch(/^https?:\/\//);
      expect(e.successRate7d).toBeGreaterThanOrEqual(0);
      expect(e.successRate7d).toBeLessThanOrEqual(1);
      expect(JSON.stringify(e)).not.toMatch(/whsec_/);
    }
  });

  it("adds an endpoint and reveals whsec_ once (FR-DSH-081, BR-DSH-001)", async () => {
    const { endpoint, secret } = await api.createEndpoint("test", { url: "https://acme.example/webhooks/elapse", events: "*" });
    expect(secret).toMatch(/^whsec_[A-Za-z0-9]{24,}$/);
    expect(endpoint.events).toBe("*");
    const listed = (await api.listEndpoints("test")).find((e) => e.id === endpoint.id)!;
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("requires https outside localhost and a known event subset (FR-DSH-081)", async () => {
    await expect(api.createEndpoint("test", { url: "http://acme.example/x", events: "*" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(api.createEndpoint("test", { url: "http://localhost:3000/x", events: "*" })).resolves.toBeTruthy();
    await expect(
      api.createEndpoint("test", { url: "https://acme.example/x", events: ["subscription.exploded" as never] }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("updates, disables, and rolls the secret with grace (FR-DSH-082)", async () => {
    const { endpoint } = await api.createEndpoint("test", { url: "https://acme.example/a", events: ["invoice.settled"] });
    const updated = await api.updateEndpoint(endpoint.id, { url: "https://acme.example/b", events: "*", disabled: true });
    expect(updated.url).toBe("https://acme.example/b");
    expect(updated.disabled).toBe(true);
    const rolled = await api.rollEndpointSecret(endpoint.id, { graceMs: 3_600_000 });
    expect(rolled.secret).toMatch(/^whsec_/);
    expect(rolled.endpoint.previousSecretExpiresAt).toBe(NOW + 3_600_000);
  });

  it("sends a test event that shows up as a delivery for that endpoint (FR-DSH-082)", async () => {
    const ep = (await api.listEndpoints("test")).find((e) => !e.disabled);
    const before = (await api.listDeliveries(ep!.id)).length;
    const { event } = await api.sendTestEvent(ep!.id, "subscription.canceled");
    expect(event.type).toBe("subscription.canceled");
    const after = await api.listDeliveries(ep!.id);
    expect(after.length).toBe(before + 1);
    expect(after[0]!.event.id).toBe(event.id);
  });

  it("lists deliveries with attempts, status words, and a signature header (FR-DSH-083/084)", async () => {
    const ep = (await api.listEndpoints("test")).find((e) => !e.disabled);
    const deliveries = await api.listDeliveries(ep!.id);
    expect(deliveries.length).toBeGreaterThan(0);
    const statuses = new Set(deliveries.map((d) => d.status));
    expect([...statuses].every((s) => ["pending", "succeeded", "failed", "exhausted", "skipped"].includes(s))).toBe(true);
    const withAttempt = deliveries.find((d) => d.attempts.length > 0)!;
    const a = withAttempt.attempts[0]!;
    expect(a.requestHeaders["X-Elapse-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(a.requestBody).toContain('"type"');
    expect(withAttempt.maxAttempts).toBe(8);
  });

  it("resend adds a manual attempt without resetting the schedule (FR-DSH-084)", async () => {
    const ep = (await api.listEndpoints("test")).find((e) => !e.disabled);
    const row = (await api.listDeliveries(ep!.id)).find((d) => d.status === "exhausted")!;
    expect(row).toBeDefined();
    expect(row.attempts).toHaveLength(1); // a list row is a summary: last attempt only, like the API
    const exhausted = await api.getDelivery(row.id);
    const n = exhausted.attempts.length;
    expect(exhausted.attemptsMade).toBe(n);
    const after = await api.resendDelivery(exhausted.id, { idempotencyKey: "rs_1" });
    expect(after.attempts.length).toBe(n + 1);
    expect(after.attempts[after.attempts.length - 1]!.manual).toBe(true);
    const again = await api.resendDelivery(exhausted.id, { idempotencyKey: "rs_1" });
    expect(again.attempts.length).toBe(n + 1);
  });

  it("lists events with pending counts and a payload; filters by type (FR-DSH-090/091)", async () => {
    const all = await api.listEvents("test", {});
    expect(all.length).toBeGreaterThan(10);
    const settled = await api.listEvents("test", { type: "invoice.settled" });
    expect(settled.every((e) => e.type === "invoice.settled")).toBe(true);
    const one = await api.getEvent(all[0]!.id);
    expect(one.event.payload).toHaveProperty("type");
    expect(Array.isArray(one.deliveries)).toBe(true);
  });

  it("makes the checklist see an endpoint and a succeeded delivery (FR-DSH-020)", async () => {
    const { devToken } = await api.requestMagicLink("fresh@example.com");
    await api.verifyMagicLink(devToken);
    await api.completeFirstRun({ name: "Fresh" });
    expect(await api.checklist("test")).toMatchObject({ hasEndpoint: false, hasSucceededDelivery: false });
    const { endpoint } = await api.createEndpoint("test", { url: "https://fresh.example/hook", events: "*" });
    expect((await api.checklist("test")).hasEndpoint).toBe(true);
    await api.sendTestEvent(endpoint.id, "subscription.created");
    expect((await api.checklist("test")).hasSucceededDelivery).toBe(true);
  });
});
