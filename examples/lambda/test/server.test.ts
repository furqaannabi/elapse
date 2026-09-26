import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, sweepOnce } from "../src/server";
import { createSessionStore } from "../src/session";
import type { Executor, RunResult } from "../src/executor";
import { canceled, completed, created, sign } from "./sign";

const SECRET = "whsec_test_secret";
const NOW = Date.UTC(2026, 8, 13, 10, 0, 0);

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** Records every code string it is asked to run, so tests can prove it was not called. */
function spyExecutor(): Executor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(code: string): Promise<RunResult> {
      calls.push(code);
      return { ok: true, result: 4, ms: 1, logs: [] };
    },
  };
}

async function start(over: Record<string, unknown> = {}) {
  const sessions = (over.sessions as ReturnType<typeof createSessionStore>) ?? createSessionStore({ dailyRunLimit: 20 });
  const executor = spyExecutor();
  const lines: string[] = [];
  const canceled: string[] = [];
  const startedSubs: string[] = [];
  const pausedSubs: string[] = [];
  const resumedSubs: string[] = [];
  const deps = {
    sessions,
    executor,
    webhookSecret: SECRET,
    log: (l: string) => lines.push(l),
    logJson: false,
    createCheckoutSession: async () => ({ id: "cs_1" }),
    // FR-EXM-157: unreachable by default, so a test that does not care about claims cannot be
    // quietly adopting one.
    retrieveSubscription: async () => ({ k: "unreachable" as const }),
    ourProduct: "prod_northwind",
    retrievePauseMs: 1,
    startSubscription: async (sub: string) => {
      startedSubs.push(sub);
    },
    pauseSubscription: async (sub: string) => {
      pausedSubs.push(sub);
      // The platform answers 202 and the webhook follows; the fake lands it immediately.
      sessions.applyPaused(sub, { nowMs: NOW });
    },
    resumeSubscription: async (sub: string) => {
      resumedSubs.push(sub);
      sessions.applyActive(sub, { startedAt: NOW, nowMs: NOW });
    },
    startTimeoutMs: 300,
    startPollMs: 10,
    cancelSubscription: async (sub: string) => {
      canceled.push(sub);
    },
    product: { name: "Serverless runtime", rateUsdPerSecond: "0.002" },
    maxDurationSeconds: 3600,
    elapse: { publishableKey: "pk_test_abc", apiUrl: "https://api.elapse.finance", appUrl: "https://elapse.finance" },
    now: () => NOW,
    ...over,
  } as Parameters<typeof createServer>[0];
  const server = createServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  close = () => new Promise((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, sessions, executor, lines, canceled, startedSubs, pausedSubs, resumedSubs, deps };
}

const CODE = "return 2+2";
const run = (base: string, sub: string, code: string = CODE) =>
  fetch(`${base}/run?sub=${sub}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });

describe("FR-EXM-114 first Run opens a session to authorise, in the page", () => {
  it("does not execute without a session; answers 409 with the session id for <Authorize>", async () => {
    const { base, executor } = await start();
    const res = await run(base, "none");
    expect(res.status).toBe(409);
    // No checkout URL: the console renders <Authorize session> in place (FR-EXM-152).
    expect(await res.json()).toEqual({ needs_start: true, session: "cs_1" });
    expect(executor.calls).toEqual([]);
  });
});

describe("FR-EXM-125 the first Run starts the meter", () => {
  /** Answers the Run, then plays the platform: the start webhook lands `after` ms later. */
  const startAndConfirm = async (
    o: { base: string; sessions: ReturnType<typeof createSessionStore>; sub: string; after: number | null },
  ) => {
    const pending = run(o.base, o.sub);
    if (o.after !== null) {
      setTimeout(() => o.sessions.applyActive(o.sub, { startedAt: NOW, nowMs: NOW }), o.after);
    }
    return pending;
  };

  it("starts the meter once, waits for the chain, then runs the stashed code", async () => {
    const { base, sessions, executor, startedSubs, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const res = await startAndConfirm({ base, sessions, sub: "sub_1", after: 30 });
    expect(res.status).toBe(200);
    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE]);
    // FR-EXM-153 (amended 2026-09-21): the meter stays on after the run; the subscriber ends it.
    expect(canceled).toEqual([]);
  });

  it("a second Run while starting waits on the same start instead of starting again", async () => {
    const { base, sessions, executor, startedSubs } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const first = startAndConfirm({ base, sessions, sub: "sub_1", after: 60 });
    const second = startAndConfirm({ base, sessions, sub: "sub_1", after: null });
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE, CODE]);
  });

  it("no active in time: cancels for a full refund, 503, nothing ran, no daily run spent", async () => {
    const sessions = createSessionStore({ dailyRunLimit: 2 });
    const { base, executor, canceled } = await start({ sessions });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const res = await run(base, "sub_1");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The meter didn't start, so nothing ran and nothing was charged." });
    expect(executor.calls).toEqual([]);
    expect(canceled).toEqual(["sub_1"]);
    expect(sessions.tryConsumeRun(NOW)).toBe(true);
    expect(sessions.tryConsumeRun(NOW)).toBe(true); // both of the day's runs are still there
  });

  it("a later Run reuses the open session and starts nothing a second time", async () => {
    const { base, sessions, executor, startedSubs } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    await startAndConfirm({ base, sessions, sub: "sub_1", after: 10 });

    // FR-EXM-153 (amended 2026-09-21): the meter is still running, so this Run just invokes.
    const res = await run(base, "sub_1", "return 1");
    expect(res.status).toBe(200);
    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE, "return 1"]);
  });
});

describe("FR-EXM-125 a start refused because the escrow has not ingested yet", () => {
  // 2026-09-23, from the recording: the console claims the session the instant the popup signs, so
  // the first Run can reach `subscriptions.start` a second before `checkout.session.completed`
  // ingests. The platform then has no `stream_address` yet and answers "The subscriber has not
  // authorised this session yet." Giving up there strands a funded meter the subscriber already
  // paid for, and leaves the console offering to end a session that never ran.
  it("retries inside the start window instead of stranding a funded session", async () => {
    const attempts: string[] = [];
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const { base, executor, canceled } = await start({
      sessions,
      startSubscription: async (sub: string) => {
        attempts.push(sub);
        if (attempts.length === 1) throw new Error("The subscriber has not authorised this session yet.");
        setTimeout(() => sessions.applyActive(sub, { startedAt: NOW, nowMs: NOW }), 10);
      },
    });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const res = await run(base, "sub_1");
    expect(res.status).toBe(200);
    expect(attempts).toEqual(["sub_1", "sub_1"]);
    expect(executor.calls).toEqual([CODE]);
    expect(canceled).toEqual([]);
  });

  it("gives up at the window rather than retrying for ever", async () => {
    const attempts: string[] = [];
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const { base, executor, lines } = await start({
      sessions,
      startSubscription: async (sub: string) => {
        attempts.push(sub);
        throw new Error("The subscriber has not authorised this session yet.");
      },
    });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const res = await run(base, "sub_1");
    expect(res.status).toBe(503);
    expect(attempts.length).toBeGreaterThan(1);
    expect(executor.calls).toEqual([]);
    // Reported once, not once per retry, and the session is left for another Run to try.
    expect(lines.filter((l) => l.includes("waiting for the escrow"))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("\u2717 start"))).toBe(true);
    expect(sessions.state("sub_1")).toBe("authorised");
  });
});

describe("FR-EXM-125 a Run that arrives before the webhook does", () => {
  it("waits for subscription.created instead of calling it an unknown session", async () => {
    // The subscriber authorises, the popup hands the page its sub_ id, and the page runs at once —
    // often before `subscription.created` has been delivered. Answering 409 there tells the console
    // to open *another* checkout session, which is how a subscriber ends up authorising twice.
    const { base, sessions, executor, startedSubs } = await start({ knownTimeoutMs: 2_000, knownPollMs: 10 });
    const pending = run(base, "sub_late");
    setTimeout(() => sessions.applyAuthorised("sub_late", { nowMs: NOW }), 40);
    setTimeout(() => sessions.applyActive("sub_late", { startedAt: NOW, nowMs: NOW }), 120);

    const res = await pending;
    expect(res.status).toBe(200);
    expect(startedSubs).toEqual(["sub_late"]);
    expect(executor.calls).toEqual([CODE]);
  });

  it("refuses when that subscription never turns up, rather than asking for a new session", async () => {
    // Inverted by FR-EXM-114's 2026-09-22 amendment. This test used to assert the opposite — a
    // subscription that never turned up got a fresh Checkout session — which is the loop that
    // stranded $21.60: the subscriber authorises again, that one is not delivered either, and
    // round it goes. Not knowing is no longer an answer the subscriber pays for.
    const opened: string[] = [];
    const { base, executor } = await start({
      knownTimeoutMs: 120,
      knownPollMs: 10,
      createCheckoutSession: async () => {
        opened.push("cs");
        return { id: "cs_1" };
      },
    });
    const res = await run(base, "sub_neverEver");
    expect(res.status).toBe(503);
    expect(opened).toEqual([]);
    expect(executor.calls).toEqual([]);
  });

  it("a Run with no session at all does not wait", async () => {
    const { base } = await start({ knownTimeoutMs: 30_000, knownPollMs: 10 });
    const started = Date.now();
    expect((await run(base, "none")).status).toBe(409);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("FR-EXM-153 the meter runs only while code runs", () => {
  it("the first Run starts the meter and leaves it running", async () => {
    const { base, sessions, executor, startedSubs, pausedSubs, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    expect((await pending).status).toBe(200);

    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE]);
    // FR-EXM-153 (amended 2026-09-21): the meter runs until the subscriber ends it. Ending it with
    // the run is what forced a fresh authorisation on every Run and left nothing to press.
    expect(canceled).toEqual([]);
    expect(pausedSubs).toEqual([]);
    expect(sessions.isActive("sub_1")).toBe(true);
  });

  it("a second Run invokes on the same session, asking for no second authorisation", async () => {
    const { base, sessions, executor, startedSubs, resumedSubs, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const first = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    await first;

    const second = await run(base, "sub_1", "return 1");
    expect(second.status).toBe(200);
    expect(executor.calls).toEqual([CODE, "return 1"]);
    expect(startedSubs).toEqual(["sub_1"]); // started once, ever
    expect(resumedSubs).toEqual([]); // nothing was paused, so nothing had to resume
    expect(canceled).toEqual([]);
  });

  it("resumes a meter the sweep paused, so pressing Run simply works", async () => {
    const { base, sessions, executor, resumedSubs, startedSubs } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });
    sessions.applyPaused("sub_1", { nowMs: NOW }); // the idle sweep pauses it while they read

    const res = await run(base, "sub_1", "return 1");
    expect(res.status).toBe(200);
    // Resumed, not started: the meter has existed since their first Run and their authorisation
    // still covers it. Without this the auto-pause of FR-EXM-154 would strand the console.
    expect(resumedSubs).toEqual(["sub_1"]);
    expect(startedSubs).toEqual([]);
    expect(executor.calls).toEqual(["return 1"]);
  });

  it("a run that fails leaves the meter running, so the subscriber can fix it and run again", async () => {
    const executor = { calls: [] as string[], async run(code: string) { this.calls.push(code); return { ok: false as const, error: "boom", ms: 1, logs: [] }; } };
    const { base, sessions, pausedSubs, canceled } = await start({ executor });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    expect((await pending).status).toBe(200);
    // Throwing is the normal case while writing code; ending the session for it would charge a
    // fresh authorisation for every typo.
    expect(canceled).toEqual([]);
    expect(pausedSubs).toEqual([]);
    expect(sessions.isActive("sub_1")).toBe(true);
  });

});

describe("FR-EXM-113 /access and a paused meter", () => {
  it("reports a paused meter as paused, not as ended", async () => {
    const { base, sessions } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });
    sessions.applyPaused("sub_1", { nowMs: NOW + 60_000 });

    // A paused session has not ended. Nothing is accruing, but the authorisation and the escrow are
    // both still live and a Run resumes it — telling the console "ended" would send the subscriber
    // off to authorise a second session they do not need.
    expect(await (await fetch(`${base}/access/sub_1`)).json()).toMatchObject({ active: false, reason: "paused" });
  });
});

describe("FR-EXM-156 Northwind pauses and resumes for the subscriber", () => {
  it("pauses the viewer's meter when asked, and resumes it", async () => {
    const { base, sessions, pausedSubs, resumedSubs } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });

    // The subscriber pressed Pause in <Meter>; the ask travels over Northwind's own wire and
    // Northwind is the one that calls Elapse (FR-RCT-021).
    expect((await fetch(`${base}/pause?sub=sub_1`, { method: "POST" })).status).toBe(204);
    expect(pausedSubs).toEqual(["sub_1"]);

    expect((await fetch(`${base}/resume?sub=sub_1`, { method: "POST" })).status).toBe(204);
    expect(resumedSubs).toEqual(["sub_1"]);
  });

  it("refuses a session it has never heard of, rather than calling Elapse about it", async () => {
    const { base, pausedSubs } = await start();
    expect((await fetch(`${base}/pause?sub=sub_nope`, { method: "POST" })).status).toBe(404);
    expect(pausedSubs).toEqual([]);
  });
});

describe("FR-EXM-133 /access before the meter starts", () => {
  it("reports authorised, then starting, then running", async () => {
    const { base, sessions } = await start();
    const access = async () => (await fetch(`${base}/access/sub_1`)).json();

    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    expect(await access()).toEqual({ active: false, reason: "authorised" });

    sessions.markStarting("sub_1", NOW);
    expect(await access()).toEqual({ active: false, reason: "starting" });

    sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW });
    expect(await access()).toEqual({ active: true, reason: "running", started_at: Math.floor(NOW / 1000) });
  });
});

describe("FR-EXM-126 leaving before the meter starts", () => {
  it("the tab-close beacon cancels an authorised session for a full refund", async () => {
    const { base, sessions, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });

    const res = await fetch(`${base}/end?sub=sub_1`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(canceled).toEqual(["sub_1"]);
  });
});

describe("FR-EXM-120 running code inside a live session", () => {
  it("executes on the runner and returns its result", async () => {
    const { base, sessions, executor } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });

    const res = await run(base, "sub_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: 4, ms: 1, logs: [] });
    expect(executor.calls).toEqual([CODE]);
  });
});

describe("FR-EXM-120 the terminal shows each run", () => {
  it("logs the code, the result, how long it took and the day's count", async () => {
    const { base, sessions, lines } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });
    await run(base, "sub_1", "return 2+2");
    expect(lines.at(-1)).toBe("▶ run sub_1  return 2+2  → 4  (1ms)   [1/20 today]");
  });

  it("logs a failed run as the error, not a result", async () => {
    const executor = { calls: [] as string[], async run(code: string) { this.calls.push(code); return { ok: false as const, error: "boom", ms: 2, logs: [] }; } };
    const { base, sessions, lines } = await start({ executor });
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });
    await run(base, "sub_1", "throw new Error('boom')");
    expect(lines.at(-1)).toBe("▶ run sub_1  throw new Error('boom')  → boom  (2ms)   [1/20 today]");
  });
});

describe("FR-EXM-140 daily execution cap", () => {
  it("refuses past the cap and never reaches the runner", async () => {
    const sessions = createSessionStore({ dailyRunLimit: 2 });
    const { base, executor } = await start({ sessions });
    // One session per execution now (FR-EXM-153 amended), so the cap is spent across sessions.
    for (const sub of ["sub_1", "sub_2"]) {
      sessions.applyOpen(sub, { startedAt: NOW, nowMs: NOW });
      expect((await run(base, sub)).status).toBe(200);
    }
    sessions.applyOpen("sub_3", { startedAt: NOW, nowMs: NOW });

    const third = await run(base, "sub_3");
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "daily execution limit reached" });
    expect(executor.calls).toHaveLength(2);
  });

  it("ends the meter it just started when the cap refuses the run", async () => {
    const sessions = createSessionStore({ dailyRunLimit: 0 });
    const { base, executor, canceled, pausedSubs } = await start({ sessions });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);

    expect((await pending).status).toBe(429);
    expect(executor.calls).toEqual([]);
    // Nothing ran, but the meter was started: it must not be left accruing.
    expect(canceled).toEqual(["sub_1"]);
    expect(pausedSubs).toEqual([]);
  });
});

const deliver = async (base: string, body: string) => {
  const res = await fetch(`${base}/webhooks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-elapse-signature": sign(body, SECRET) },
    body,
  });
  await new Promise((r) => setImmediate(r)); // work runs after the 2xx (BR-EXM-102)
  return res;
};

describe("FR-EXM-132 the webhook closes the session", () => {
  it("accepts runs while open, then refuses once subscription.canceled arrives", async () => {
    const { base } = await start();

    expect((await deliver(base, created())).status).toBe(200);
    expect((await run(base, "sub_4QeABC")).status).toBe(200);

    expect((await deliver(base, canceled({}, "evt_close"))).status).toBe(200);
    const after = await run(base, "sub_4QeABC");
    expect(after.status).toBe(409);
    expect(await after.json()).toMatchObject({ needs_start: true });
  });
});

describe("FR-EXM-116/118 automatic end signals", () => {
  it("a heartbeat refreshes presence without ending anything", async () => {
    const { base, sessions, canceled: ended } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW - 10_000 });

    const res = await fetch(`${base}/heartbeat?sub=sub_1`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(sessions.get("sub_1")?.lastSeen).toBe(NOW);
    expect(ended).toEqual([]);
  });

  it("the tab-close beacon ends the session immediately, and only once", async () => {
    const { base, sessions, canceled: ended } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });

    expect((await fetch(`${base}/end?sub=sub_1`, { method: "POST" })).status).toBe(204);
    expect(ended).toEqual(["sub_1"]);

    // BR-EXM-110: a second beacon must not issue another cancel while the chain confirms.
    await fetch(`${base}/end?sub=sub_1`, { method: "POST" });
    expect(ended).toEqual(["sub_1"]);
  });
});

describe("FR-EXM-117 the server ends sessions by itself", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  /**
   * FR-EXM-154 (amended 2026-09-21): an idle session is no longer ended — it is paused, which the
   * sweep test above covers. What still ends here is a session whose viewer has gone.
   */
  it("ends a departed session once, and leaves a healthy one running", async () => {
    const { sessions, lines, canceled: ended, deps } = await start();
    sessions.applyOpen("sub_left", { startedAt: NOW, nowMs: NOW });
    sessions.applyOpen("sub_ok", { startedAt: NOW, nowMs: NOW });

    const later = NOW + 70_000;
    sessions.touch("sub_ok", later, { run: true }); // ran just now

    await sweepOnce(deps, later, windows);

    expect([...ended]).toEqual(["sub_left"]);
    expect(lines.some((l) => l.includes("auto-ended (left) sub_left"))).toBe(true);
    expect(sessions.isActive("sub_ok")).toBe(true);

    // BR-EXM-110: a later tick, before the webhook confirms, must not cancel again.
    await sweepOnce(deps, later + 5_000, windows);
    expect([...ended]).toEqual(["sub_left"]);
  });
});

describe("FR-EXM-154 (amended 2026-09-21) the sweep pauses an idle meter, it does not end it", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  it("pauses the subscriber who is still there and ends the one who left", async () => {
    const { sessions, lines, canceled: ended, pausedSubs, deps } = await start();
    sessions.applyOpen("sub_idle", { startedAt: NOW, nowMs: NOW });
    sessions.applyOpen("sub_left", { startedAt: NOW, nowMs: NOW });

    const later = NOW + 70_000;
    sessions.touch("sub_idle", later); // still heartbeating, but nothing has run

    await sweepOnce(deps, later, windows);

    // Presence is the whole difference: one is at their desk thinking, the other's tab is gone.
    // Pausing the first costs them nothing and keeps their authorisation alive.
    expect(pausedSubs).toEqual(["sub_idle"]);
    expect(ended).toEqual(["sub_left"]);
    expect(lines.some((l) => l.includes("auto-paused (idle) sub_idle"))).toBe(true);
  });
});

describe("FR-EXM-113 GET /access/:sub reports the session and its settled receipt", () => {
  it("moves from unknown to running to ended, carrying the exact gross paid", async () => {
    const { base } = await start();
    const access = async (sub: string) => (await fetch(`${base}/access/${sub}`)).json();

    expect(await access("sub_4QeABC")).toEqual({ active: false, reason: "unknown session" });

    await deliver(base, created());
    // FR-EXM-115: the console meter starts from the session's started_at, not page load.
    expect(await access("sub_4QeABC")).toEqual({ active: true, reason: "running", started_at: 1_700_000_000 });

    // rate 0.002 x 62s settles at 0.124 exactly — the receipt, not the ticking estimate.
    await deliver(base, canceled({}, "evt_close"));
    expect(await access("sub_4QeABC")).toEqual({
      active: false,
      reason: "ended",
      seconds_elapsed: 62,
      paid_usd: "0.124",
    });
  });
});

describe("FR-EXM-110/111/112 the pages", () => {
  it("GET / names the product and links into the console without starting billing", async () => {
    const { base } = await start();
    const html = await (await fetch(base)).text();
    expect(html).toContain("Serverless runtime");
    expect(html).toContain("$0.002 / second · ~$7.20 / hour");
    expect(html).toMatch(/href="console"/);
    // Navigation only: the landing hands out no checkout link, because nothing starts here.
    expect(html).not.toContain("/c/cs_");
  });

  /**
   * A per-second rate is not a price anyone can feel. "$0.002 / second" is the tariff; what the
   * visitor actually wants to know is what one run costs, and the console opens on a thirty-second
   * default (FR-EXM-122). The figure is derived from the Product's own rate, never hardcoded, so a
   * merchant who changes the rate does not leave a false price on the landing.
   */
  it("GET / prices a run in money, derived from the rate", async () => {
    const { base } = await start();
    const html = await (await fetch(base)).text();
    expect(html).toContain("30 seconds");
    expect(html).toContain("$0.06");
  });

  it("GET /console loads the bundled console with the publishable key, and no UMD React", async () => {
    const { base } = await start();
    const html = await (await fetch(`${base}/console`)).text();

    // FR-EXM-152: React and @elapse/react are bundled (npm run build:web), not loaded as UMD.
    expect(html).not.toMatch(/react[/@]18\.3\.1/);
    expect(html).toContain('<script type="module" src="web.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="web.css">');
    // Monaco may stay on its own CDN (FR-EXM-152).
    expect(html).toMatch(/monaco-editor\/0\.52\.2/);

    // What the bundle needs to configure <ElapseProvider>; never a secret key (BR-RCT-002).
    expect(html).toContain('id="root"');
    expect(html).toContain('data-publishable-key="pk_test_abc"');
    expect(html).toContain('data-api-url="https://api.elapse.finance"');
    expect(html).toContain('data-app-url="https://elapse.finance"');
    // FR-RCT-010 amended: the merchant chooses the cap, so the console never shows a cap step.
    expect(html).toContain('data-max-duration="3600"');
    expect(html).not.toContain("sk_test");

    // No hosted checkout anywhere, and no Start or Stop for the subscriber (FR-CHK-037).
    expect(html).not.toContain("/c/");
    expect(html).not.toMatch(/>\s*Start\s*</);
    expect(html).not.toMatch(/>\s*Stop\s*</);
  });

  it("serves the console bundle and its stylesheet, and says what to run when they are missing", async () => {
    const { base } = await start();
    for (const path of ["/web.js", "/web.css"]) {
      const res = await fetch(`${base}${path}`);
      if (res.status === 200) expect(res.headers.get("content-type")).toContain(path.endsWith(".js") ? "javascript" : "css");
      else {
        expect(res.status).toBe(503);
        expect(await res.text()).toContain("npm run build:web");
      }
    }
  });

  it("GET /cancel says nothing was charged", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/cancel`)).text()).toContain("Checkout canceled. Nothing was charged.");
  });

  it("serves one stylesheet that all three pages share", async () => {
    const { base } = await start();
    const css = await fetch(`${base}/northwind.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    for (const path of ["/", "/console", "/cancel"]) {
      expect(await (await fetch(`${base}${path}`)).text()).toContain('href="northwind.css"');
    }
  });
});

describe("FR-EXM-114 the console finds its session on the way back from Checkout", () => {
  it("maps the checkout session to its subscription once completed arrives", async () => {
    const { base } = await start();

    // Before the webhook there is nothing to resume.
    expect((await fetch(`${base}/session/cs_7Ha`)).status).toBe(404);

    await deliver(base, completed());

    const res = await fetch(`${base}/session/cs_7Ha`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: "sub_4QeABC" });
  });
});

describe("FR-EXM-114 when the platform refuses to open a session", () => {
  it("passes the platform's reason back readably instead of a generic 500", async () => {
    const reason = "Set a payout address in Settings before creating checkout links.";
    const { base } = await start({
      createCheckoutSession: async () => {
        throw new Error(reason);
      },
    });

    const res = await run(base, "none");
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: reason });
  });
});

describe("FR-EXM-117 a failed cancel is retried, then given up on", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000, pausedEndMs: 600_000 };

  it("retries on the next sweep when the cancel fails, but does not hammer forever", async () => {
    const attempts: string[] = [];
    const { sessions, deps, lines } = await start({
      cancelSubscription: async (sub: string) => {
        attempts.push(sub);
        throw new Error(`No such subscription: '${sub}'`);
      },
    });
    sessions.applyOpen("sub_x", { startedAt: NOW, nowMs: NOW });
    const later = NOW + 70_000;

    await sweepOnce(deps, later, windows);
    expect(attempts).toHaveLength(1);

    // The defect this covers: the session used to stay flagged `canceling` after a failure,
    // so it was never swept again and kept accruing until the escrow cap.
    await sweepOnce(deps, later + 5_000, windows);
    expect(attempts).toHaveLength(2);

    // ...but a permanently failing cancel must not be retried every tick forever.
    for (let i = 0; i < 10; i++) await sweepOnce(deps, later + 10_000 + i * 5_000, windows);
    expect(attempts.length).toBeLessThanOrEqual(5);
    expect(lines.some((l) => l.includes("giving up"))).toBe(true);
  });
});

describe("FR-EXM-157 the console claims the subscription", () => {
  const retrieved = (over: Record<string, unknown> = {}) => ({
    k: "found" as const,
    checkoutSession: "cs_1",
    product: "prod_northwind",
    status: "incomplete",
    ...over,
  });

  it("starts the meter on a claimed session although no subscription.created was ever delivered", async () => {
    // The bug this closes: with `elapse listen` down the created event produces no Delivery at all
    // (FR-API-134), so the server never learned the subscription and answered by opening ANOTHER
    // Checkout session — three authorisations of $7.20, none of them ever cancelled.
    const { base, sessions, executor, startedSubs, lines } = await start({
      retrieveSubscription: async () => retrieved(),
      ourProduct: "prod_northwind",
    });
    sessions.issueCheckout("cs_1");

    const claim = await fetch(`${base}/claim?sub=sub_1`, { method: "POST" });
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ state: "authorised" });

    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    expect((await pending).status).toBe(200);
    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE]);
    expect(lines.filter((l) => l.includes("checkout.sessions.create"))).toEqual([]);
  });

  it("refuses a Run for a session it could not verify rather than opening a second one", async () => {
    // FR-EXM-114 amended: `state === undefined` means "I do not know", and answering not-knowing
    // with a fresh Checkout session is what stranded the escrow. A well-formed `sub_` the server
    // has never adopted is refused, and the authorisation is left for the boot reconcile.
    const opened: string[] = [];
    const { base, executor } = await start({
      knownTimeoutMs: 30,
      knownPollMs: 10,
      createCheckoutSession: async () => {
        opened.push("cs");
        return { id: "cs_2" };
      },
    });

    const res = await run(base, "sub_neverclaimed");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/can't reach Elapse|does not belong/);
    expect(opened).toEqual([]);
    expect(executor.calls).toEqual([]);
  });
});

describe("FR-EXM-158 a re-adopted meter says it kept running", () => {
  it("tells the console the meter ran while the server was down", async () => {
    // The meter is on chain, not in this process, so the seconds a restart takes are billed. A
    // console that silently rejoins a meter reading two minutes higher than it left it is the one
    // thing that would make the subscriber distrust the number.
    const { base, sessions } = await start();
    sessions.applyOpen("sub_back", { startedAt: NOW - 120_000, nowMs: NOW });
    sessions.markReadopted("sub_back");

    const body = await (await fetch(`${base}/access/sub_back`)).json();
    expect(body).toMatchObject({ active: true, reason: "running", readopted: true });
  });
});

describe("FR-EXM-155 the terminal distinguishes a subscriber ending from a tab closing", () => {
  it("logs a deliberate End session as the subscriber's, not as a tab that was left", async () => {
    // Both reach `/end`, and both used to print "auto-ended (left)". On camera, and in front of a
    // judge reading the merchant's terminal, that reads as "they walked away" for the one gesture
    // this product exists to show.
    const { base, sessions, lines, canceled } = await start();
    sessions.applyOpen("sub_1", { startedAt: NOW, nowMs: NOW });

    await fetch(`${base}/end?sub=sub_1&by=subscriber`, { method: "POST" });
    expect(canceled).toEqual(["sub_1"]);
    expect(lines.some((l) => l.includes("ended (subscriber) sub_1"))).toBe(true);
    expect(lines.some((l) => l.includes("auto-ended"))).toBe(false);
  });

  it("still logs a tab-close beacon as left, because that is what it is", async () => {
    const { base, sessions, lines } = await start();
    sessions.applyOpen("sub_2", { startedAt: NOW, nowMs: NOW });

    await fetch(`${base}/end?sub=sub_2`, { method: "POST" });
    expect(lines.some((l) => l.includes("auto-ended (left) sub_2"))).toBe(true);
  });
});
