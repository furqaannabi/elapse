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
    // FR-EXM-153 (amended 2026-09-20): the session ends with the run; `subscription.canceled`
    // closes it and the console shows the receipt.
    expect(canceled).toEqual(["sub_1"]);
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

  it("a later Run needs a new session, because the first one ended with its run", async () => {
    const { base, sessions, executor, startedSubs } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    await startAndConfirm({ base, sessions, sub: "sub_1", after: 10 });

    // FR-EXM-153 (amended 2026-09-20): one session per execution, so this Run authorises again.
    const res = await run(base, "sub_1", "return 1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ needs_start: true, session: "cs_1" });
    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE]);
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

  it("still asks for a new session when that subscription never turns up", async () => {
    const { base, executor } = await start({ knownTimeoutMs: 120, knownPollMs: 10 });
    const res = await run(base, "sub_neverEver");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ needs_start: true, session: "cs_1" });
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
  it("the first Run starts, invokes, then ends the session", async () => {
    const { base, sessions, executor, startedSubs, pausedSubs, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    expect((await pending).status).toBe(200);

    expect(startedSubs).toEqual(["sub_1"]);
    expect(executor.calls).toEqual([CODE]);
    // FR-EXM-153 (amended 2026-09-20): the session ends with the run; the receipt follows the cancel.
    expect(canceled).toEqual(["sub_1"]);
    expect(pausedSubs).toEqual([]);
  });

  it("a second Run opens a new session instead of resuming the old one", async () => {
    const { base, sessions, executor, startedSubs, resumedSubs, canceled } = await start();
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const first = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    await first;

    // The cancel is in flight: `subscription.canceled` has not arrived yet.
    const second = await run(base, "sub_1", "return 1");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ needs_start: true, session: "cs_1" });
    expect(executor.calls).toEqual([CODE]); // the second Run ran nothing
    expect(startedSubs).toEqual(["sub_1"]); // started once, ever
    expect(resumedSubs).toEqual([]);
    expect(canceled).toEqual(["sub_1"]);
  });

  it("a run that fails still ends the session", async () => {
    const executor = { calls: [] as string[], async run(code: string) { this.calls.push(code); return { ok: false as const, error: "boom", ms: 1, logs: [] }; } };
    const { base, sessions, pausedSubs, canceled } = await start({ executor });
    sessions.applyAuthorised("sub_1", { nowMs: NOW });
    const pending = run(base, "sub_1");
    setTimeout(() => sessions.applyActive("sub_1", { startedAt: NOW, nowMs: NOW }), 30);
    expect((await pending).status).toBe(200);
    expect(canceled).toEqual(["sub_1"]);
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
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000 };

  it("ends a departed and an idle session once each, and leaves a healthy one running", async () => {
    const { sessions, lines, canceled: ended, deps } = await start();
    sessions.applyOpen("sub_left", { startedAt: NOW, nowMs: NOW });
    sessions.applyOpen("sub_idle", { startedAt: NOW, nowMs: NOW });
    sessions.applyOpen("sub_ok", { startedAt: NOW, nowMs: NOW });

    const later = NOW + 70_000;
    sessions.touch("sub_idle", later); // still heartbeating, but nothing has run
    sessions.touch("sub_ok", later, { run: true }); // ran just now

    await sweepOnce(deps, later, windows);

    expect([...ended].sort()).toEqual(["sub_idle", "sub_left"]);
    expect(lines.some((l) => l.includes("auto-ended (idle) sub_idle"))).toBe(true);
    expect(lines.some((l) => l.includes("auto-ended (left) sub_left"))).toBe(true);
    expect(sessions.isActive("sub_ok")).toBe(true);

    // BR-EXM-110: a later tick, before the webhook confirms, must not cancel again.
    await sweepOnce(deps, later + 5_000, windows);
    expect([...ended].sort()).toEqual(["sub_idle", "sub_left"]);
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
    expect(html).toMatch(/href="\/console"/);
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
    expect(html).toContain('<script type="module" src="/web.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/web.css">');
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
      expect(await (await fetch(`${base}${path}`)).text()).toContain('href="/northwind.css"');
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
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000 };

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
