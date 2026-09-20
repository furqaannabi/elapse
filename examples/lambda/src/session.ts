/**
 * FR-EXM-116/117/130/140: the server's in-memory session state. Holds the session map,
 * deduplicates Events by `evt_` id, counts runs against a per-UTC-day cost cap, and decides
 * which sessions are due to be auto-ended. The actual `subscriptions.cancel` call and the
 * webhook that confirms it live in the server (BR-EXM-110); this module is pure state so it
 * tests without the SDK or a clock.
 */

/**
 * FR-EXM-133: where a session is in its life. `authorised` means the subscriber signed the permit
 * and the money is escrowed but nothing is accruing; `starting` means the merchant asked the
 * platform to start the meter and the chain has not confirmed yet; `active` means it is accruing.
 *
 * FR-EXM-153: between runs the meter is paused, so the subscriber pays only for the seconds their
 * code runs. `pausing` and `resuming` are the windows where the platform has been asked and the
 * chain has not answered; nothing may be invoked in either.
 */
export type SessionState = "authorised" | "starting" | "active" | "paused" | "ended";

export interface Session {
  state: SessionState;
  /**
   * Whether a console has ever said it is here for this session. `subscription.created` arrives from
   * the webhook, not the page, so before the first heartbeat there is nothing to measure presence
   * against (FR-EXM-126).
   */
  seen: boolean;
  /** `state === "active"`, kept as a field so the routes and tests read the same word as before. */
  active: boolean;
  canceling: boolean;
  customer?: string;
  startedAt?: number;
  lastSeen: number;
  lastRun: number;
  cancelAttempts?: number;
  secondsElapsed?: number;
  paidUsd?: string;
  updatedAt: number;
}

const utcDay = (nowMs: number): number => Math.floor(nowMs / 86_400_000);

export function createSessionStore(opts: { dailyRunLimit: number }) {
  let runDay = -1;
  let runCount = 0;
  const seen = new Set<string>();
  const sessions = new Map<string, Session>();
  const checkouts = new Map<string, string>();

  return {
    /** FR-EXM-140: consume one run against the UTC-day cap; false when the day is spent. */
    tryConsumeRun(nowMs: number): boolean {
      const day = utcDay(nowMs);
      if (day !== runDay) {
        runDay = day;
        runCount = 0;
      }
      if (runCount >= opts.dailyRunLimit) return false;
      runCount += 1;
      return true;
    },

    /** FR-EXM-140: how many runs today's cap has taken, for the terminal's `[n/20 today]`. */
    runsToday(nowMs: number): { used: number; limit: number } {
      return { used: utcDay(nowMs) === runDay ? runCount : 0, limit: opts.dailyRunLimit };
    },

    /** FR-EXM-130: true when this Event id was already handled (redelivery). Marks it seen. */
    seenEvent(evtId: string): boolean {
      if (seen.has(evtId)) return true;
      seen.add(evtId);
      return false;
    },

    /**
     * FR-EXM-114: which Subscription a Checkout session became. The console polls this on the
     * way back from Checkout, because the subscription does not exist until the meter starts.
     */
    linkCheckout(checkoutId: string, sub: string): void {
      checkouts.set(checkoutId, sub);
    },

    subForCheckout(checkoutId: string): string | undefined {
      return checkouts.get(checkoutId);
    },

    get(sub: string): Session | undefined {
      return sessions.get(sub);
    },

    isActive(sub: string): boolean {
      return sessions.get(sub)?.state === "active";
    },

    /** FR-EXM-133: the session's state, or `undefined` for a subscription this server never saw. */
    state(sub: string): SessionState | undefined {
      return sessions.get(sub)?.state;
    },

    /**
     * FR-EXM-133: `subscription.created` for a `merchant`-mode product. The subscriber has paid
     * into escrow and nothing is accruing; the first Run starts the meter (FR-EXM-125).
     */
    applyAuthorised(sub: string, info: { customer?: string; nowMs: number }): void {
      const prev = sessions.get(sub);
      sessions.set(sub, {
        ...prev,
        state: "authorised",
        seen: prev?.seen ?? false,
        active: false,
        canceling: false,
        cancelAttempts: 0,
        ...(info.customer === undefined ? {} : { customer: info.customer }),
        lastSeen: info.nowMs,
        lastRun: info.nowMs,
        updatedAt: info.nowMs,
      });
    },

    /** FR-EXM-125: `subscriptions.start` was accepted; wait for the chain, start nothing twice. */
    markStarting(sub: string, nowMs: number): void {
      const prev = sessions.get(sub);
      if (!prev) return;
      sessions.set(sub, { ...prev, state: "starting", active: false, lastSeen: nowMs, updatedAt: nowMs });
    },

    /** FR-EXM-133: `subscription.updated` with `status: "paused"` — a merchant paused it elsewhere. */
    applyPaused(sub: string, info: { nowMs: number }): void {
      const prev = sessions.get(sub);
      if (!prev) return;
      sessions.set(sub, { ...prev, state: "paused", active: false, updatedAt: info.nowMs });
    },

    /** FR-EXM-133: `subscription.updated` with `status: "active"` — the meter is running now. */
    applyActive(sub: string, info: { startedAt: number; nowMs: number }): void {
      const prev = sessions.get(sub);
      if (!prev) return;
      sessions.set(sub, {
        ...prev,
        state: "active",
        seen: true,
        active: true,
        canceling: false,
        startedAt: info.startedAt,
        lastSeen: info.nowMs,
        lastRun: info.nowMs,
        updatedAt: info.nowMs,
      });
    },

    /** FR-EXM-131: `subscription.created` — the meter is running. */
    applyOpen(sub: string, info: { customer?: string; startedAt: number; nowMs: number }): void {
      const prev = sessions.get(sub);
      sessions.set(sub, {
        ...prev,
        state: "active",
        // A running meter accrues whether or not a console ever appeared, so it is always sweepable.
        seen: true,
        active: true,
        canceling: false,
        cancelAttempts: 0,
        ...(info.customer === undefined ? {} : { customer: info.customer }),
        startedAt: info.startedAt,
        lastSeen: info.nowMs,
        lastRun: info.nowMs,
        updatedAt: info.nowMs,
      });
    },

    /**
     * FR-EXM-116: record activity. Every console heartbeat refreshes presence (`lastSeen`);
     * only a Run also refreshes `lastRun`, which is what the idle timeout measures.
     */
    touch(sub: string, nowMs: number, opts?: { run?: boolean }): void {
      const prev = sessions.get(sub);
      if (!prev) return;
      sessions.set(sub, {
        ...prev,
        seen: true,
        lastSeen: nowMs,
        lastRun: opts?.run ? nowMs : prev.lastRun,
        updatedAt: nowMs,
      });
    },

    /**
     * FR-EXM-117/126: which sessions should be auto-ended now, and why. `left` means the
     * console stopped heartbeating (tab closed, network gone); `idle` means it is still there
     * but nothing has run. A session already `canceling` is skipped so `subscriptions.cancel`
     * is issued once per session while the chain confirms (BR-EXM-110).
     */
    dueForAutoEnd(nowMs: number, windows: { idleTimeoutMs: number; heartbeatStaleMs: number }): Array<{ sub: string; reason: "left" | "idle" }> {
      const due: Array<{ sub: string; reason: "left" | "idle" }> = [];
      for (const [sub, s] of sessions) {
        if (s.state === "ended" || s.canceling) continue;
        // FR-EXM-126: nothing to measure until the console has been heard from at least once.
        if (!s.seen) continue;
        if (nowMs - s.lastSeen > windows.heartbeatStaleMs) due.push({ sub, reason: "left" });
        // FR-EXM-126: before the meter starts there is no idle timeout — editing code costs nothing.
        // FR-EXM-154 (amended 2026-09-20): a session ends with its run, so the timeout no longer
        // governs a running meter. It is cleanup for one left running because its cancel was
        // refused — `noteCancelFailure` clears the guard above, and this picks it up.
        else if (s.state !== "authorised" && s.state !== "starting" && nowMs - s.lastRun > windows.idleTimeoutMs) {
          due.push({ sub, reason: "idle" });
        }
      }
      return due;
    },

    /** FR-EXM-117/118: a cancel has been issued; do not issue another until the webhook lands. */
    markCanceling(sub: string): void {
      const prev = sessions.get(sub);
      if (prev) sessions.set(sub, { ...prev, canceling: true });
    },

    /**
     * FR-EXM-117: a cancel attempt failed. Clear the in-flight guard so the next sweep tries
     * again — a session whose cancel failed must not be left running and accruing — and return
     * how many attempts have now failed, so the caller can stop after a few.
     */
    noteCancelFailure(sub: string): number {
      const prev = sessions.get(sub);
      if (!prev) return 0;
      const cancelAttempts = (prev.cancelAttempts ?? 0) + 1;
      sessions.set(sub, { ...prev, canceling: false, cancelAttempts });
      return cancelAttempts;
    },

    /** FR-EXM-131: `subscription.canceled` / `invoice.payment_failed` — the meter has stopped. */
    applyClosed(sub: string, info: { secondsElapsed?: number; paidUsd?: string; nowMs: number }): void {
      const prev = sessions.get(sub) ?? { seen: false, lastSeen: info.nowMs, lastRun: info.nowMs };
      sessions.set(sub, {
        ...prev,
        state: "ended",
        active: false,
        canceling: false,
        ...(info.secondsElapsed === undefined ? {} : { secondsElapsed: info.secondsElapsed }),
        ...(info.paidUsd === undefined ? {} : { paidUsd: info.paidUsd }),
        updatedAt: info.nowMs,
      });
    },
  };
}
