/**
 * The in-memory account API used until the real one exists.
 *
 * FR-CHK-016 (passkey sign-in), FR-CHK-018 (meters across merchants),
 * FR-CHK-019 (cancel), FR-CHK-020 (receipts), FR-CHK-022 (identity is the
 * wallet, never shown), FR-CHK-023 (empty), FR-CHK-025 (seeds by URL).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockAccountApi, ACCOUNT_SEEDS } from "./mock-api";

const NOW = 1_756_800_000_000;

describe("mock account api", () => {
  let api: ReturnType<typeof createMockAccountApi>;
  let now = NOW;
  beforeEach(() => {
    now = NOW;
    api = createMockAccountApi({ now: () => now, latencyMs: 0, seed: "two-merchants" });
  });

  it("names a seed per screen (FR-CHK-025)", () => {
    expect([...ACCOUNT_SEEDS]).toEqual(["two-merchants", "empty", "low-balance", "signed-out"]);
  });

  it("starts signed out on the signed-out seed and signs in with a passkey (FR-CHK-016)", async () => {
    const out = createMockAccountApi({ now: () => now, latencyMs: 0, seed: "signed-out" });
    expect((await out.getView()).status).toBe("signed_out");
    const v = await out.signIn();
    expect(v.status).toBe("signed_in");
  });

  it("lists meters across merchants, newest first (FR-CHK-018)", async () => {
    const v = await api.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    expect(v.meters).toHaveLength(2);
    expect(new Set(v.meters.map((m) => m.merchant.name)).size).toBe(2);
    expect(v.meters[0].startedAt).toBeGreaterThan(v.meters[1].startedAt);
  });

  it("never exposes the wallet address that groups them (FR-CHK-022)", async () => {
    const v = await api.getView();
    expect(JSON.stringify(v)).not.toMatch(/0x[0-9a-f]{6}/i);
  });

  it("shows receipts with what was paid and what came back (FR-CHK-020)", async () => {
    const v = await api.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    expect(v.receipts.length).toBeGreaterThan(0);
    const r = v.receipts[0];
    expect(r.amountSettledUsd).toMatch(/^\d+\.\d{2,3}$/);
    expect(Object.keys(r)).not.toContain("fee");
  });

  it("cancel settles whole seconds, returns the rest, and moves the row to receipts (FR-CHK-019)", async () => {
    const before = await api.getView();
    if (before.status !== "signed_in") throw new Error("expected signed in");
    const target = before.meters[0];
    now += 17_000;
    const { receipt, view } = await api.cancel(target.subscription);
    expect(receipt.endedReason).toBe("canceled");
    expect(receipt.merchant.name).toBe(target.merchant.name);
    if (view.status !== "signed_in") throw new Error("expected signed in");
    expect(view.meters.map((m) => m.subscription)).not.toContain(target.subscription);
    expect(view.receipts[0].subscription).toBe(target.subscription);
  });

  it("a meter past its cap has already ended when the page reads it (FR-CHK-007)", async () => {
    const v0 = await api.getView();
    if (v0.status !== "signed_in") throw new Error("expected signed in");
    const cap = v0.meters[0].maxDurationSeconds;
    now += cap * 1000 + 60_000;
    const v = await api.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    expect(v.meters.map((m) => m.subscription)).not.toContain(v0.meters[0].subscription);
    const r = v.receipts.find((x) => x.subscription === v0.meters[0].subscription);
    expect(r?.endedReason).toBe("cap_reached");
    expect(r?.seconds).toBe(cap);
  });

  it("cancelling something that is not running fails", async () => {
    await expect(api.cancel("sub_nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("the empty seed has no meters and no receipts (FR-CHK-023)", async () => {
    const e = createMockAccountApi({ now: () => now, latencyMs: 0, seed: "empty" });
    const v = await e.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    expect(v.meters).toHaveLength(0);
    expect(v.receipts).toHaveLength(0);
  });

  it("the low-balance seed has a meter within five minutes of its cap (FR-CHK-006)", async () => {
    const l = createMockAccountApi({ now: () => now, latencyMs: 0, seed: "low-balance" });
    const v = await l.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    const m = v.meters[0];
    const left = m.maxDurationSeconds * 1000 - (now - m.startedAt);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(5 * 60_000);
  });

  it("email receipt resolves (mocked send)", async () => {
    const v = await api.getView();
    if (v.status !== "signed_in") throw new Error("expected signed in");
    await expect(api.emailReceipt(v.receipts[0].invoice)).resolves.toEqual({ sent: true });
  });
});
