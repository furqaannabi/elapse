import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 12, 10, 0, 0); // 2026-09-12 10:00 UTC

describe("FR-EXM-140 daily run limit", () => {
  it("allows up to the limit per UTC day, then rejects, and resets next day", () => {
    const s = createSessionStore({ dailyRunLimit: 3 });
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(false); // 4th same day
    expect(s.tryConsumeRun(t0 + DAY)).toBe(true); // next UTC day resets
  });
});

describe("FR-EXM-130 evt dedupe", () => {
  it("reports an event id unseen the first time and seen after", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    expect(s.seenEvent("evt_1")).toBe(false);
    expect(s.seenEvent("evt_1")).toBe(true);
    expect(s.seenEvent("evt_2")).toBe(false);
  });
});

describe("FR-EXM-131 session open and close", () => {
  it("opens on created and closes on canceled, recording the settled receipt", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    expect(s.isActive("sub_1")).toBe(false);

    s.applyOpen("sub_1", { customer: "cus_1", startedAt: t0, nowMs: t0 });
    expect(s.isActive("sub_1")).toBe(true);
    expect(s.get("sub_1")?.startedAt).toBe(t0);

    s.applyClosed("sub_1", { secondsElapsed: 62, paidUsd: "0.12", nowMs: t0 + 62_000 });
    expect(s.isActive("sub_1")).toBe(false);
    expect(s.get("sub_1")).toMatchObject({ active: false, canceling: false, secondsElapsed: 62, paidUsd: "0.12" });
  });
});

describe("FR-EXM-116 heartbeat and run activity", () => {
  it("a heartbeat refreshes presence only; a run refreshes presence and idle", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });

    s.touch("sub_1", t0 + 5_000); // heartbeat
    expect(s.get("sub_1")).toMatchObject({ lastSeen: t0 + 5_000, lastRun: t0 });

    s.touch("sub_1", t0 + 9_000, { run: true });
    expect(s.get("sub_1")).toMatchObject({ lastSeen: t0 + 9_000, lastRun: t0 + 9_000 });
  });
});

describe("FR-EXM-117 auto-end sweep", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };
  const now = t0 + 70_000;

  const store = () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    // left: opened, never heartbeat again
    s.applyOpen("sub_left", { startedAt: t0, nowMs: t0 });
    // idle: still heartbeating, but no Run since t0
    s.applyOpen("sub_idle", { startedAt: t0, nowMs: t0 });
    s.touch("sub_idle", now);
    // healthy: ran just now
    s.applyOpen("sub_ok", { startedAt: t0, nowMs: t0 });
    s.touch("sub_ok", now, { run: true });
    return s;
  };

  it("ends a vanished viewer's session and pauses a present-but-inactive one", () => {
    const due = store().dueForSweep(now, windows);
    expect(due).toEqual(expect.arrayContaining([
      { sub: "sub_left", action: "end", reason: "left" },
      { sub: "sub_idle", action: "pause", reason: "idle" },
    ]));
    expect(due.map((d) => d.sub)).not.toContain("sub_ok");
  });

  it("does not re-issue a cancel for a session already canceling", () => {
    const s = store();
    expect(s.dueForSweep(now, windows).map((d) => d.sub)).toContain("sub_idle");
    s.markCanceling("sub_idle");
    expect(s.dueForSweep(now, windows).map((d) => d.sub)).not.toContain("sub_idle");
  });
});

describe("FR-EXM-133 the session's state follows the webhooks", () => {
  it("authorised on created, active on updated, with the event's started_at", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { customer: "cus_1", nowMs: t0 });
    expect(s.state("sub_1")).toBe("authorised");
    expect(s.isActive("sub_1")).toBe(false);
    expect(s.get("sub_1")?.startedAt).toBeUndefined();

    s.markStarting("sub_1", t0 + 1_000);
    expect(s.state("sub_1")).toBe("starting");
    expect(s.isActive("sub_1")).toBe(false);

    s.applyActive("sub_1", { startedAt: t0 + 4_000, nowMs: t0 + 4_000 });
    expect(s.state("sub_1")).toBe("active");
    expect(s.isActive("sub_1")).toBe(true);
    expect(s.get("sub_1")?.startedAt).toBe(t0 + 4_000);

    s.applyClosed("sub_1", { secondsElapsed: 9, paidUsd: "0.018", nowMs: t0 + 13_000 });
    expect(s.state("sub_1")).toBe("ended");
  });

  it("an unknown subscription has no state", () => {
    expect(createSessionStore({ dailyRunLimit: 20 }).state("sub_nope")).toBeUndefined();
  });
});

describe("FR-EXM-153 the session ends with its run", () => {
  it("a paused session keeps its start time, so the receipt still knows when it began", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { nowMs: t0 });
    s.applyActive("sub_1", { startedAt: t0, nowMs: t0 });
    s.applyPaused("sub_1", { nowMs: t0 + 5_000 });
    expect(s.get("sub_1")?.startedAt).toBe(t0);
  });
});

describe("FR-EXM-154 the idle timeout is cleanup, not billing", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  it("leaves a session whose cancel is in flight alone until the webhook lands", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { nowMs: t0 });
    s.applyActive("sub_1", { startedAt: t0, nowMs: t0 });
    s.markCanceling("sub_1");
    s.touch("sub_1", t0 + 70_000);
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([]);
  });
});

describe("FR-EXM-154 (amended 2026-09-21) an idle meter pauses rather than ends", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  it("pauses a subscriber who is present but has run nothing, instead of ending their session", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    // Still here — the heartbeats keep arriving — but nothing has run for longer than the window.
    s.touch("sub_1", t0 + 70_000);
    // Paused seconds are never billed (BR-CON-003), so walking away from the tab costs the
    // subscriber a minute of meter, not the session and not a second authorisation.
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "pause", reason: "idle" }]);
  });

  it("ends a session whose tab is gone rather than pausing someone who is not there", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    s.touch("sub_1", t0 + 1_000); // last heard from a second in, then silence
    // Northwind sells compute, so a subscriber who has left is done — pausing would hold a session
    // open for someone who is never coming back to it.
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "end", reason: "left" }]);
  });

  it("leaves a paused session alone while it is present, and ends it once it is abandoned", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    s.applyPaused("sub_1", { nowMs: t0 + 60_000 });

    // Still heartbeating, five minutes paused: nothing is accruing, so there is nothing to reclaim
    // and no second pause to issue.
    s.touch("sub_1", t0 + 360_000);
    expect(s.dueForSweep(t0 + 360_000, windows)).toEqual([]);

    // Past the paused window the escrow is held for someone who is not coming back. Refund it.
    s.touch("sub_1", t0 + 700_000);
    expect(s.dueForSweep(t0 + 700_000, windows)).toEqual([{ sub: "sub_1", action: "end", reason: "abandoned" }]);
  });

  it("does not ask for a second pause while the first is still confirming", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    s.touch("sub_1", t0 + 70_000);
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "pause", reason: "idle" }]);

    // `paused` arrives by webhook a second or two later. Until it does the meter still reads active,
    // so without a guard every sweep tick would send another relayer transaction (BR-EXM-110).
    s.markPausing("sub_1");
    expect(s.dueForSweep(t0 + 75_000, windows)).toEqual([]);
  });

  it("retries an end that failed instead of pausing a session the subscriber asked to close", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    s.markCanceling("sub_1");
    s.noteCancelFailure("sub_1"); // the cancel was refused, so the guard cleared for a retry
    s.touch("sub_1", t0 + 70_000);
    // The intent was to end. Pausing here would quietly hold a session open — and its escrow —
    // for a subscriber who already asked for it back.
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "end", reason: "abandoned" }]);
  });

  it("never starts the idle clock before the meter does — editing code is free (FR-EXM-126)", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { nowMs: t0 });
    s.touch("sub_1", t0 + 70_000); // present the whole time, has not pressed Run yet
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([]);
  });
});

describe("FR-EXM-126 a session the console has not reached yet", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  it("is not swept before the console has ever said it is here", () => {
    // `subscription.created` arrives from the webhook, not from the page: the console cannot
    // heartbeat until it has resolved the sub_ id, and sweeping on the webhook's clock kills the
    // session out from under a subscriber who is still mid-flow. The platform's unstarted sweep
    // (worker FR-WRK-075) is the backstop for one that really was abandoned.
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { nowMs: t0 });
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([]);

    // Once the console has been heard from, the stale window applies as before.
    s.touch("sub_1", t0 + 1_000);
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "end", reason: "left" }]);
  });

  it("a running meter is always swept: it is accruing whether or not a console ever appeared", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });
    expect(s.dueForSweep(t0 + 70_000, windows)).toEqual([{ sub: "sub_1", action: "end", reason: "left" }]);
  });
});

describe("FR-EXM-126 leaving before the meter starts", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };
  const now = t0 + 70_000;

  it("a vanished viewer is due even before start; an idle one is not, because editing costs nothing", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_gone", { nowMs: t0 });
    s.touch("sub_gone", t0);                                // the console was here, then vanished
    s.applyAuthorised("sub_here", { nowMs: t0 });          // still here, still editing
    s.touch("sub_here", now);
    s.markStarting("sub_starting", t0);                     // unknown session: nothing to start
    s.applyAuthorised("sub_starting", { nowMs: t0 });
    s.touch("sub_starting", t0);
    s.markStarting("sub_starting", t0);

    const due = s.dueForSweep(now, windows);
    expect(due).toContainEqual({ sub: "sub_gone", action: "end", reason: "left" });
    expect(due).toContainEqual({ sub: "sub_starting", action: "end", reason: "left" });
    expect(due.map((d) => d.sub)).not.toContain("sub_here");
  });

  it("an ended session is never due again", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyAuthorised("sub_1", { nowMs: t0 });
    s.applyClosed("sub_1", { nowMs: t0 });
    expect(s.dueForSweep(now, windows)).toEqual([]);
  });
});

describe("FR-EXM-157 the checkout sessions Northwind has issued", () => {
  it("remembers a session it opened until the claim that consumes it", () => {
    // Northwind learned `cs_` ids only from `checkout.session.completed` before this, which is a
    // webhook — the very thing a claim exists to survive.
    const s = createSessionStore({ dailyRunLimit: 20 });
    expect(s.issuedCheckouts().has("cs_1")).toBe(false);
    s.issueCheckout("cs_1");
    expect(s.issuedCheckouts().has("cs_1")).toBe(true);
    s.consumeCheckout("cs_1");
    expect(s.issuedCheckouts().has("cs_1")).toBe(false);
  });
});
