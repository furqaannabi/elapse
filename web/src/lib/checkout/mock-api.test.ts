/**
 * The in-memory checkout API used until the real one exists.
 *
 * FR-CHK-015 (seeded sessions for every state), FR-CHK-002 (sign in),
 * FR-CHK-003/004 (fund → start), FR-CHK-007 (pause reason), FR-CHK-008
 * (cancel settles whole seconds and refunds the rest), BR-CHK-003.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMockCheckoutApi, SEEDED_SESSION_IDS } from "./mock-api";
import { deriveView } from "./view";

const NOW = 1_756_800_000_000;

describe("mock checkout api", () => {
  let api: ReturnType<typeof createMockCheckoutApi>;
  let now = NOW;
  beforeEach(() => {
    now = NOW;
    api = createMockCheckoutApi({ now: () => now, latencyMs: 0 });
  });

  it("seeds one session per screen (FR-CHK-015)", async () => {
    const expected: Record<string, string> = {
      cs_demo: "signin",
      cs_ready: "ready",
      cs_running: "running",
      cs_lowbal: "low_balance",
      cs_empty: "out_of_funds",
      cs_paused: "paused",
      cs_done: "canceled",
      cs_expired: "expired",
      cs_used: "used",
      cs_archived: "archived",
    };
    expect(Object.keys(expected).sort()).toEqual([...SEEDED_SESSION_IDS].sort());
    for (const [id, view] of Object.entries(expected)) {
      const s = await api.getSession(id);
      expect(deriveView(s, now), id).toBe(view);
    }
  });

  it("unknown session rejects with a not_found error", async () => {
    await expect(api.getSession("cs_nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("sign in attaches a customer", async () => {
    const s = await api.signIn("cs_demo", { email: "ada@example.com" });
    expect(s.customer?.id).toMatch(/^cus_/);
    expect(s.customer?.email).toBe("ada@example.com");
    expect(deriveView(s, now)).toBe("fund");
  });

  it("fund creates the subscription escrow; start records started_at (FR-CHK-003/004)", async () => {
    await api.signIn("cs_demo", {});
    let s = await api.fund("cs_demo", "10");
    expect(s.subscription?.fundedUsd).toBe("10");
    expect(deriveView(s, now)).toBe("ready");
    s = await api.start("cs_demo");
    expect(s.subscription?.status).toBe("active");
    expect(s.subscription?.startedAt).toBe(now);
    expect(deriveView(s, now)).toBe("running");
  });

  it("funding again adds to the escrow", async () => {
    await api.signIn("cs_demo", {});
    await api.fund("cs_demo", "5");
    const s = await api.fund("cs_demo", "5");
    expect(s.subscription?.fundedUsd).toBe("10");
  });

  it("cancel settles whole seconds and reports the refund (FR-CHK-008, BR-CHK-003)", async () => {
    await api.signIn("cs_demo", {});
    await api.fund("cs_demo", "10");
    await api.start("cs_demo");
    now += 83_400; // 83.4 s
    const { session, receipt } = await api.cancel("cs_demo");
    expect(session.subscription?.status).toBe("canceled");
    expect(session.subscription?.canceledAt).toBe(now);
    expect(session.status).toBe("complete");
    expect(receipt.secondsElapsed).toBe(83);
    expect(receipt.amountSettledUsd).toBe("0.332"); // 83 × 0.004, shown exactly
    expect(receipt.refundedUsd).toBe("9.668");
  });

  it("pause and resume freeze and continue elapsed time", async () => {
    await api.signIn("cs_demo", {});
    await api.fund("cs_demo", "10");
    await api.start("cs_demo");
    now += 10_000;
    let s = await api.pause("cs_demo");
    expect(s.subscription?.status).toBe("paused");
    expect(s.subscription?.pauseReason).toBe("user");
    now += 60_000;
    s = await api.resume("cs_demo");
    expect(s.subscription?.status).toBe("active");
    // startedAt shifted forward by the paused duration so elapsed stays 10 s
    expect(now - (s.subscription?.startedAt ?? 0)).toBe(10_000);
  });

  it("email receipt resolves (mocked send)", async () => {
    await expect(api.emailReceipt("cs_done", "ada@example.com")).resolves.toEqual({ sent: true });
  });

  it("judge data exposes chain detail without leaking merchant secrets", async () => {
    const j = await api.getJudgeData("cs_running");
    expect(j.chainId).toBe(10143);
    expect(j.contractAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(j.deliveries.length).toBeGreaterThan(0);
    expect(JSON.stringify(j)).not.toMatch(/sk_|whsec_/);
  });
});
