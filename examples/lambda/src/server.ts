import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Executor } from "./executor";
import { handleWebhook, type SessionStore } from "./webhooks";
import type { SessionState } from "./session";
import { DEFAULT_SNIPPET } from "../runner/snippet.mjs";

/**
 * FR-EXM-110–120: the merchant's HTTP server on Node's built-in module (no framework, so the
 * webhook body arrives raw). The subscriber never presses Start or Stop: the first `/run`
 * begins the session (FR-EXM-114) and the server ends it by itself (FR-EXM-117/118).
 *
 * Every platform call is injected as a function so the routes test without an API or AWS.
 */

export interface ServerDeps {
  sessions: SessionStore;
  executor: Executor;
  webhookSecret: string;
  log: (line: string) => void;
  logJson?: boolean;
  /** `checkout.sessions.create` with the session cap, behind a function (FR-EXM-114). */
  createCheckoutSession: () => Promise<{ id: string }>;
  /** `subscriptions.start`, behind a function (FR-EXM-125). */
  startSubscription: (sub: string) => Promise<void>;
  /** FR-EXM-125: how long the first Run waits for the chain before refunding. Default 30 s. */
  startTimeoutMs?: number;
  /** How long a Run waits for `subscription.created` to arrive for a subscription it does not know. Default 15 s. */
  knownTimeoutMs?: number;
  /** How often that wait re-reads the store. Default 250 ms. */
  knownPollMs?: number;
  /** How often that wait re-reads the session state. Default 250 ms. */
  startPollMs?: number;
  /** `subscriptions.cancel`, behind a function (BR-EXM-110). */
  cancelSubscription: (sub: string) => Promise<void>;
  product: { name: string; rateUsdPerSecond: string };
  /** What the console page hands to <ElapseProvider> (FR-EXM-152). */
  elapse: { publishableKey: string; apiUrl: string; appUrl: string };
  /** FR-RCT-010 amended: the cap the merchant authorises for, so the console shows no cap step. */
  maxDurationSeconds: number;
  now: () => number;
}

/** FR-EXM-110/111/112: the merchant's own pages (ADR 2026-09-06), plain files under public/. */
const asset = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const LANDING = asset("index.html");
const CONSOLE = asset("console.html");
const CANCEL = asset("cancel.html");
const STYLE = asset("northwind.css");
const RUNNER_SOURCE = readFileSync(new URL("../runner/index.mjs", import.meta.url), "utf8");

const MERCHANT = "Northwind Compute";

/** What `npm run build:web` writes into `dist/`, served to the console page (FR-EXM-152). */
const BUNDLE: Record<string, { file: string; type: string } | undefined> = {
  "/web.js": { file: "web.js", type: "text/javascript; charset=utf-8" },
  "/web.css": { file: "web.css", type: "text/css; charset=utf-8" },
};
const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => escapeHtml(vars[k] ?? ""));
/** Display only; the money that matters is settled on the platform (BR-EXM-106). */
const hourly = (rate: string) => (Number(rate) * 3600).toFixed(2);

export function createServer(deps: ServerDeps) {
  // FR-EXM-153: runs are serialised per subscription. Each one resumes the meter and pauses it
  // again, so two overlapping runs would fight over the same stream.
  const queues = new Map<string, Promise<unknown>>();
  return createHttpServer((req, res) => {
    route(req, res, deps, queues).catch((err: Error) => {
      deps.log(`✗ ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) send(res, 500, "text/plain", "Something went wrong.");
    });
  });
}

async function route(req: IncomingMessage, res: ServerResponse, deps: ServerDeps, queues: Map<string, Promise<unknown>>): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  // FR-EXM-120: run code, but only inside a session that is actually running.
  if (req.method === "POST" && url.pathname === "/run") {
    const sub = url.searchParams.get("sub") ?? "";
    // FR-EXM-125: the popup hands the page its `sub_` id the moment the permit is signed, so a Run
    // can easily arrive before `subscription.created` has been delivered. Answering "unknown
    // session" there would send the subscriber back to authorise a second one, so wait for it.
    const state = (await knownState(sub, deps)) ?? deps.sessions.state(sub);
    // FR-EXM-153 (amended 2026-09-20): one session per execution. A session whose cancel is in
    // flight is spent even though `subscription.canceled` has not landed yet, so the next Run
    // opens a new one rather than invoking on a dying meter.
    const spent = deps.sessions.get(sub)?.canceling === true;
    if (state === undefined || state === "ended" || spent) {
      // FR-EXM-114 (amended): no session yet — open one and hand back its id. The console renders
      // <Authorize session> in place (FR-EXM-152); nobody leaves this page.
      let session;
      try {
        session = await deps.createCheckoutSession();
      } catch (err) {
        // The platform refuses for reasons a person can act on ("Set a payout address…"),
        // so pass its sentence through instead of a blank 500 (FR-EXM-100).
        const message = (err as Error).message || "could not open a session";
        deps.log(`✗ checkout.sessions.create: ${message}`);
        return send(res, 502, "application/json", JSON.stringify({ error: message }));
      }
      return send(res, 409, "application/json", JSON.stringify({ needs_start: true, session: session.id }));
    }
    const { code } = JSON.parse(await readRaw(req)) as { code?: string };
    // Reject rubbish before it costs a daily run, and before the meter is touched.
    if (typeof code !== "string" || code.trim() === "") {
      return send(res, 400, "application/json", JSON.stringify({ error: "code must be a non-empty string" }));
    }
    // One run at a time per subscription: the next one waits for this one's pause to land.
    const answer = await queued(queues, sub, () => runOnce(sub, code, deps));
    return send(res, answer.status, "application/json", JSON.stringify(answer.body));
  }

  const vars = {
    merchant: MERCHANT,
    product: deps.product.name,
    price: `$${deps.product.rateUsdPerSecond} / second · ~$${hourly(deps.product.rateUsdPerSecond)} / hour`,
    rate: deps.product.rateUsdPerSecond,
  };
  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, "text/html; charset=utf-8", fill(LANDING, vars));
  }
  if (req.method === "GET" && url.pathname === "/console") {
    return send(
      res,
      200,
      "text/html; charset=utf-8",
      fill(CONSOLE, { ...vars, max_duration_seconds: String(deps.maxDurationSeconds), publishable_key: deps.elapse.publishableKey, api_url: deps.elapse.apiUrl, app_url: deps.elapse.appUrl }),
    );
  }
  // FR-EXM-152: the console's bundle, with React and @elapse/react inside it.
  const asset_ = BUNDLE[url.pathname];
  if (req.method === "GET" && asset_) {
    let body: string;
    try {
      body = readFileSync(new URL(`../dist/${asset_.file}`, import.meta.url), "utf8");
    } catch {
      return send(res, 503, "text/plain", "The console bundle is missing. Run: npm run build:web");
    }
    return send(res, 200, asset_.type, body);
  }
  if (req.method === "GET" && url.pathname === "/cancel") {
    return send(res, 200, "text/html; charset=utf-8", fill(CANCEL, vars));
  }
  if (req.method === "GET" && url.pathname === "/northwind.css") {
    return send(res, 200, "text/css; charset=utf-8", STYLE);
  }

  // FR-EXM-122: the JavaScript the console opens on.
  if (req.method === "GET" && url.pathname === "/default-snippet") {
    return send(res, 200, "text/plain; charset=utf-8", DEFAULT_SNIPPET);
  }

  // FR-EXM-111: the console shows what the runner actually does, read-only.
  if (req.method === "GET" && url.pathname === "/runner-source") {
    return send(res, 200, "text/plain; charset=utf-8", RUNNER_SOURCE);
  }

  // FR-EXM-114: the console polls this coming back from Checkout to learn its session.
  const resuming = url.pathname.match(/^\/session\/([\w-]+)$/);
  if (req.method === "GET" && resuming) {
    const sub = deps.sessions.subForCheckout(resuming[1] as string);
    if (!sub) return send(res, 404, "application/json", JSON.stringify({ error: "not found" }));
    return send(res, 200, "application/json", JSON.stringify({ sub }));
  }

  // FR-EXM-113: is this session running, and if it has ended, what did it actually cost?
  // The figure here is the settled receipt from the webhook, not the console's ticking estimate.
  const access = url.pathname.match(/^\/access\/([\w-]+)$/);
  if (req.method === "GET" && access) {
    const session = deps.sessions.get(access[1] as string);
    if (!session) return send(res, 200, "application/json", JSON.stringify({ active: false, reason: "unknown session" }));
    // FR-EXM-133: before the meter starts the console is told which side of the start it is on.
    if (session.state === "authorised" || session.state === "starting")
      return send(res, 200, "application/json", JSON.stringify({ active: false, reason: session.state }));
    if (session.active)
      return send(
        res,
        200,
        "application/json",
        JSON.stringify({ active: true, reason: "running", ...(session.startedAt === undefined ? {} : { started_at: Math.floor(session.startedAt / 1000) }) }),
      );
    return send(
      res,
      200,
      "application/json",
      JSON.stringify({
        active: false,
        reason: "ended",
        ...(session.secondsElapsed === undefined ? {} : { seconds_elapsed: session.secondsElapsed }),
        ...(session.paidUsd === undefined ? {} : { paid_usd: session.paidUsd }),
      }),
    );
  }

  // FR-EXM-116: the console says "still here" every few seconds while it is open.
  if (req.method === "POST" && url.pathname === "/heartbeat") {
    deps.sessions.touch(url.searchParams.get("sub") ?? "", deps.now());
    return send(res, 204, "text/plain", "");
  }

  // FR-EXM-118: the tab-close beacon — end now rather than waiting for the sweep.
  if (req.method === "POST" && url.pathname === "/end") {
    await endSession(url.searchParams.get("sub") ?? "", "left", deps);
    return send(res, 204, "text/plain", "");
  }

  // FR-EXM-130: verify the raw bytes, answer fast, then do the merchant work (BR-EXM-102).
  // The webhook is the source of truth for whether a session is open (FR-EXM-132).
  if (req.method === "POST" && url.pathname === "/webhooks") {
    const raw = await readRaw(req);
    const header = req.headers["x-elapse-signature"];
    const out = handleWebhook(raw, Array.isArray(header) ? header[0] : header, {
      secret: deps.webhookSecret,
      sessions: deps.sessions,
      log: deps.log,
      now: deps.now,
      ...(deps.logJson === undefined ? {} : { logJson: deps.logJson }),
    });
    send(res, out.status, "application/json", out.body);
    if (out.work) setImmediate(out.work);
    return;
  }

  send(res, 404, "text/plain", "Not found");
}

/**
 * The state of a subscription this server may not have heard about yet. A well-formed `sub_` id that
 * is simply unknown is waited on until `subscription.created` lands (FR-EXM-133); anything else —
 * `none` from a page with no session, or an id that never turns up — falls through at once.
 */
async function knownState(sub: string, deps: ServerDeps) {
  const known = deps.sessions.state(sub);
  if (known !== undefined || !/^sub_[A-Za-z0-9]+$/.test(sub)) return known;
  const deadline = Date.now() + (deps.knownTimeoutMs ?? 15_000);
  const pollMs = deps.knownPollMs ?? 250;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const state = deps.sessions.state(sub);
    if (state !== undefined) return state;
  }
  return undefined;
}

/** Runs `fn` after whatever is already queued for this subscription, and keeps the queue moving. */
async function queued<T>(queues: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const mine = previous.then(fn, fn);
  queues.set(key, mine.catch(() => {}));
  return mine;
}

/**
 * One run: make sure the meter is on (FR-EXM-125/153), invoke, pause again, and answer. The daily
 * cap (BR-EXM-109) is consumed only once the runner is actually about to be called.
 */
async function runOnce(sub: string, code: string, deps: ServerDeps): Promise<{ status: number; body: unknown }> {
  const state = deps.sessions.state(sub);
  if (state !== "active") {
    const running = await ensureRunning(sub, state ?? "paused", deps);
    if (!running) {
      return { status: 503, body: { error: "The meter didn't start, so nothing ran and nothing was charged." } };
    }
  }
  const now = deps.now();
  if (!deps.sessions.tryConsumeRun(now)) {
    // The meter is on and nothing will run: end it rather than bill the refusal.
    await endSession(sub, "run", deps);
    return { status: 429, body: { error: "daily execution limit reached" } };
  }
  deps.sessions.touch(sub, now, { run: true });
  let result;
  try {
    result = await deps.executor.run(code);
  } finally {
    // FR-EXM-153 (amended 2026-09-20): the session ends the moment the run does, whether it
    // returned or threw. One session per execution; the next Run authorises a new one.
    await endSession(sub, "run", deps);
  }
  // FR-EXM-120: one line per run, so the terminal shows what the meter is being paid for.
  const outcome = result.ok ? JSON.stringify(result.result) : result.error;
  const { used, limit } = deps.sessions.runsToday(now);
  deps.log(`▶ run ${sub}  ${oneLine(code)}  → ${outcome}  (${result.ms}ms)   [${used}/${limit} today]`);
  return { status: 200, body: result };
}

/**
 * FR-EXM-153: stop the meter now that the run is over. A pause that the platform refuses is logged
 * and left alone — the session stays active, the idle sweep still ends it, and the subscriber is
 * never billed for a pause we failed to make rather than for seconds they used.
 */
async function ensureRunning(sub: string, state: SessionState, deps: ServerDeps): Promise<boolean> {
  if (state === "authorised") {
    deps.sessions.markStarting(sub, deps.now());
    try {
      await deps.startSubscription(sub);
      deps.log(`▶ starting meter ${sub}`);
    } catch (err) {
      // The start never happened: put the session back so the next Run can try again.
      deps.sessions.applyAuthorised(sub, { nowMs: deps.now() });
      deps.log(`✗ start ${sub}: ${(err as Error).message}`);
      return false;
    }
  }
  const timeoutMs = deps.startTimeoutMs ?? 30_000;
  const pollMs = deps.startPollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (deps.sessions.isActive(sub)) return true;
    if (deps.sessions.state(sub) === "ended") return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (deps.sessions.isActive(sub)) return true;
  await endSession(sub, "left", deps);
  return false;
}

/** The submitted code on one line, short enough to read in a terminal. */
function oneLine(code: string, max = 40): string {
  const flat = code.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** The exact bytes the platform signed; never JSON-parse before verifying (BR-SDK-003). */
function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** How many times a failing `subscriptions.cancel` is retried before the sweep gives up. */
const MAX_CANCEL_ATTEMPTS = 5;

/**
 * FR-EXM-117/118: end a session server-side, at most once while a cancel is in flight. The `canceling` flag is set before
 * the await so a second beacon or the next sweep tick cannot issue a second cancel while the
 * chain confirms; the `subscription.canceled` webhook is what finally closes it (BR-EXM-110).
 */
export async function endSession(sub: string, reason: "left" | "idle" | "run", deps: ServerDeps): Promise<void> {
  const session = deps.sessions.get(sub);
  // FR-EXM-126: an authorised or starting session is cancelled too — a full refund, since
  // nothing has accrued yet.
  if (!session || session.state === "ended" || session.canceling) return;
  deps.sessions.markCanceling(sub);
  deps.log(reason === "run" ? `⏹ ended with the run ${sub}` : `⏹ auto-ended (${reason}) ${sub}`);
  try {
    await deps.cancelSubscription(sub);
  } catch (err) {
    // A failed cancel must not strand the session: clear the guard so the next sweep retries.
    // Swallowing it here also stops one bad session aborting the rest of the sweep tick.
    const message = (err as Error).message;
    const attempts = deps.sessions.noteCancelFailure(sub);
    if (attempts >= MAX_CANCEL_ATTEMPTS) {
      deps.sessions.markCanceling(sub); // stop trying; the escrow cap is the backstop (FR-EXM-119)
      deps.log(`✗ cancel ${sub} failed ${attempts}×, giving up: ${message}`);
    } else {
      deps.log(`✗ cancel ${sub} failed (attempt ${attempts}), will retry: ${message}`);
    }
  }
}

/**
 * FR-EXM-117: one tick of the auto-end sweep, which the boot script runs on a timer. The store
 * decides *which* sessions are due and *why*; this only carries the decision out, so the timing
 * rules stay testable without a server, a clock, or the SDK.
 */
export async function sweepOnce(
  deps: ServerDeps,
  nowMs: number,
  windows: { idleTimeoutMs: number; heartbeatStaleMs: number },
): Promise<void> {
  for (const { sub, reason } of deps.sessions.dueForAutoEnd(nowMs, windows)) {
    await endSession(sub, reason, deps);
  }
}
