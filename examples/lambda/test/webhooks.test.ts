import { describe, expect, it } from "vitest";
import { grossUsd, handleWebhook } from "../src/webhooks";
import { createSessionStore } from "../src/session";
import { authorised, canceled, created, sign, started } from "./sign";

const SECRET = "whsec_test";
const deps = (sessions = createSessionStore({ dailyRunLimit: 20 })) => ({
  secret: SECRET,
  sessions,
  log: () => {},
  now: () => Date.UTC(2026, 8, 12, 10, 0, 0),
  logJson: false,
});

describe("FR-EXM-130 verify before act", () => {
  it("rejects a tampered body with 400 and changes no session", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const body = created();
    const signature = sign(body, SECRET);
    const res = handleWebhook(body.replace("sub_4QeABC", "sub_EVIL"), signature, deps(sessions));
    expect(res.status).toBe(400);
    expect(sessions.isActive("sub_EVIL")).toBe(false);
    expect(sessions.isActive("sub_4QeABC")).toBe(false);
  });
});

describe("FR-EXM-131 session lifecycle", () => {
  it("opens the session on subscription.created", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const body = created();
    const res = handleWebhook(body, sign(body, SECRET), { ...deps(sessions), log: (l) => lines.push(l) });
    expect(res.status).toBe(200);
    res.work!();
    expect(sessions.isActive("sub_4QeABC")).toBe(true);
    expect(lines[0]).toContain("session open sub_4QeABC");
  });
});

describe("FR-EXM-133 merchant-started sessions follow the webhooks", () => {
  const post = (body: string, sessions: ReturnType<typeof createSessionStore>, lines: string[] = []) => {
    const res = handleWebhook(body, sign(body, SECRET), { ...deps(sessions), log: (l) => lines.push(l) });
    res.work!();
    return lines;
  };

  it("created opens it authorised with no started_at; updated active starts the meter", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines = post(authorised(), sessions);
    expect(sessions.state("sub_4QeABC")).toBe("authorised");
    expect(sessions.isActive("sub_4QeABC")).toBe(false);
    expect(sessions.get("sub_4QeABC")?.startedAt).toBeUndefined();
    expect(lines[0]).toContain("session authorised sub_4QeABC");

    post(started(), sessions, lines);
    expect(sessions.state("sub_4QeABC")).toBe("active");
    expect(sessions.get("sub_4QeABC")?.startedAt).toBe(1_700_000_040_000);
    expect(lines[1]).toContain("meter started sub_4QeABC");
  });

  it("an update that says paused stops the session's meter (FR-EXM-153)", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    post(authorised(), sessions);
    post(started(), sessions);
    const lines = post(started({ status: "paused" }, "evt_paused"), sessions);
    expect(sessions.state("sub_4QeABC")).toBe("paused");
    expect(lines[0]).toContain("meter paused sub_4QeABC");
  });

  it("an update this merchant does not act on is only synced", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    post(authorised(), sessions);
    const lines = post(started({ status: "incomplete" }, "evt_synced"), sessions);
    expect(sessions.state("sub_4QeABC")).toBe("authorised");
    expect(lines[0]).toContain("sync session (incomplete)");
  });
});

describe("FR-EXM-131 exact settled receipt", () => {
  it("closes on canceled and records the exact gross paid, displayed to two decimals", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const open = created();
    handleWebhook(open, sign(open, SECRET), { ...deps(sessions), log: () => {} }).work!();

    const body = canceled({}, "evt_close");
    handleWebhook(body, sign(body, SECRET), { ...deps(sessions), log: (l) => lines.push(l) }).work!();

    expect(sessions.isActive("sub_4QeABC")).toBe(false);
    // rate 0.002 x 62s = 0.124 exactly; shown as $0.12
    expect(sessions.get("sub_4QeABC")).toMatchObject({ secondsElapsed: 62, paidUsd: "0.124" });
    expect(lines[0]).toContain("session closed · 62s · $0.12");
  });

  it("BR-EXM-106 multiplies the rate as a decimal string, never a float", () => {
    expect(grossUsd("0.002", 62)).toBe("0.124");
    expect(grossUsd("0.004", 83)).toBe("0.332");
    expect(grossUsd("0.1", 3)).toBe("0.3"); // 0.1*3 = 0.30000000000000004 in float
  });
});

describe("BR-EXM-103 redelivery", () => {
  it("treats a redelivered event as a no-op", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const body = created();
    const d = { ...deps(sessions), log: (l: string) => lines.push(l) };
    handleWebhook(body, sign(body, SECRET), d).work!();
    handleWebhook(body, sign(body, SECRET), d).work!();
    expect(lines.filter((l) => l.includes("session open"))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("↺ duplicate"))).toBe(true);
  });
});
