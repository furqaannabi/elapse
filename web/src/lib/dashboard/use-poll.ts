/**
 * `usePoll` — the dashboard's read loop. Calls `fetcher` on mount and then
 * every `intervalMs` while the tab is visible; stops when hidden; resumes
 * (with an immediate fetch) on focus. A failed poll keeps the last good
 * data and sets `stale` so the page can show "Reconnecting…" quietly.
 *
 * A new `fetcher` identity (for example after a Test/Live switch) restarts
 * the loop and hides the previous data immediately, so two modes are never
 * on screen together (BR-DSH-002). Responses that arrive out of order are
 * dropped, so overlapping polls never show stale rows (FR-DSH-113).
 *
 * Maps to: FR-DSH-007, FR-DSH-113.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PollState<T> = {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: unknown;
  reload: () => Promise<void>;
};

type Fetcher<T> = () => Promise<T>;

export function usePoll<T>(
  fetcher: Fetcher<T>,
  { intervalMs = 10_000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
): PollState<T> {
  // Data is remembered together with the fetcher that produced it, so a
  // changed fetcher reads as "no data yet" without a setState in an effect.
  const [state, setState] = useState<{ by: Fetcher<T> | null; data: T | null; stale: boolean; error: unknown }>({
    by: null,
    data: null,
    stale: false,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    const by = fetcherRef.current;
    try {
      const next = await by();
      if (mine !== seq.current) return;
      setState({ by, data: next, stale: false, error: null });
    } catch (e) {
      if (mine !== seq.current) return;
      setState((s) => ({ by, data: s.by === by ? s.data : null, stale: true, error: e }));
    }
  }, []);

  useEffect(() => {
    fetcherRef.current = fetcher;
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      void run();
      id = setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [run, intervalMs, enabled, fetcher]);

  const current = state.by === fetcher;
  return {
    data: current ? state.data : null,
    loading: !current || (state.data === null && !state.stale),
    stale: current && state.stale,
    error: current ? state.error : null,
    reload: run,
  };
}
