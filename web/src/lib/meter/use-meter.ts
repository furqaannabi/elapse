/**
 * `useMeter` — drives a live per-second meter from a rate and timestamps.
 *
 * The hook does no network work. Given `rate`, `startedAt`, and an optional
 * `pausedAt`, it re-renders on a fixed cadence (default 100ms) and returns
 * the elapsed/accrued values already formatted for the instrument readout.
 * It stops ticking when paused or when the document is hidden, so a
 * background tab never burns CPU.
 *
 * Maps to: CLAUDE.md "The meter"; detailed doc §7 "300ms ticker from rate
 * math + started_at".
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  accruedNano,
  elapsedMs,
  formatElapsed,
  formatUsd,
  parseRate,
  type ElapsedParts,
} from "./math";

export type UseMeterInput = {
  /** USD per second, decimal string. */
  rate: string;
  /** Epoch ms; null/undefined means the meter has not started. */
  startedAt?: number | null;
  /** Epoch ms; freezes the meter when set. */
  pausedAt?: number | null;
  /** Re-render cadence in ms. Default 100. */
  tickMs?: number;
};

export type MeterState = {
  running: boolean;
  elapsedMs: number;
  elapsed: ElapsedParts;
  accruedNano: bigint;
  /** Three-decimal live amount, e.g. "$0.332". */
  accruedLive: string;
  /** Two-decimal amount, e.g. "$0.33". */
  accrued: string;
  rateNano: bigint;
};

export function useMeter({
  rate,
  startedAt,
  pausedAt,
  tickMs = 100,
}: UseMeterInput): MeterState {
  const rateNano = useMemo(() => parseRate(rate), [rate]);
  const running = Boolean(startedAt) && !pausedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), tickMs);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const onVisibility = () =>
      document.visibilityState === "visible" ? start() : stop();
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [running, tickMs]);

  const ms = startedAt
    ? elapsedMs({ startedAt, now: running ? now : (pausedAt ?? now), pausedAt })
    : 0;
  const nano = accruedNano(rateNano, ms);

  return {
    running,
    elapsedMs: ms,
    elapsed: formatElapsed(ms, { parts: true }),
    accruedNano: nano,
    accruedLive: formatUsd(nano, 3),
    accrued: formatUsd(nano, 2),
    rateNano,
  };
}
