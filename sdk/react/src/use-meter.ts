/**
 * `useMeter(session)` — the live meter without markup (FR-RCT-020/021/022/030/031). `<Meter>` is built
 * only from this hook.
 *
 * Elapsed and accrued come from `rate × (now − started_at)` on the shared meter math, ticking at
 * 100 ms, capped at the session's cap; nothing is sent per second. The session is re-read every 5 s
 * and on focus, so a stop from the merchant or the cap ending reaches the page (checkout FR-CHK-032).
 * Controls follow the start mode: a merchant-started meter cannot be stopped or paused by the
 * subscriber (FR-CHK-037, FR-API-139); a held one can be stopped for a full refund.
 */
import { accruedNano, elapsedMs, formatElapsed, formatUsd, parseRate } from "./math";
import { useCallback, useEffect, useRef, useState } from "react";
import { explorerUrl } from "./explorer";
import { formatAmount } from "./money";
import { SignatureError, type SignAction } from "./popup";
import { useSignature } from "./signature";
import { useElapseConfig } from "./provider";
import { fetchPublicSession, type PublicSession } from "./session";
import type { StepEvent } from "./use-authorize";

const TICK_MS = 100;
const FOLLOW_MS = 5_000;

export type MeterView = "loading" | "error" | "waiting" | "held" | "running" | "paused" | "ended";

export interface MeterHandlers {
  onStopped?: (e: StepEvent) => void;
  onPaused?: (e: StepEvent) => void;
  onResumed?: (e: StepEvent) => void;
  onError?: (e: Error) => void;
}

export interface MeterReceipt {
  seconds: number;
  paid: string;
  returned: string;
  startedAt: number | null;
  endedAt: number | null;
  endedReason: "canceled" | "cap_reached";
}

export function useMeter(sessionId: string, handlers: MeterHandlers = {}) {
  const config = useElapseConfig();
  // FR-RCT-043: every signature — stop, pause, resume — happens in the frame or its fallback window.
  const { request, modal } = useSignature(sessionId);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<SignAction | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const read = useCallback(() => {
    fetchPublicSession(config, sessionId).then(
      (s) => {
        setSession(s);
        setError(null);
      },
      (e: Error) => {
        setError((prev) => prev ?? e.message);
        handlersRef.current.onError?.(e);
      },
    );
  }, [config, sessionId]);

  useEffect(() => {
    read();
  }, [read]);

  const sub = session?.subscription ?? null;
  const held = !!sub && sub.status === "incomplete" && sub.startMode === "merchant" && parseRate(sub.fundedUsd) > 0n;
  const view: MeterView = error && !session
    ? "error"
    : !session
      ? "loading"
      : !sub
        ? "waiting"
        : sub.status === "canceled"
          ? "ended"
          : sub.status === "active"
            ? "running"
            : sub.status === "paused"
              ? "paused"
              : held
                ? "held"
                : "waiting";

  // Follow the server until the meter has ended (FR-CHK-032).
  useEffect(() => {
    if (view === "ended" || view === "loading" || view === "error") return;
    const id = setInterval(read, FOLLOW_MS);
    window.addEventListener("focus", read);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", read);
    };
  }, [view, read]);

  // The readout ticks only while money is accruing.
  useEffect(() => {
    if (view !== "running") return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [view]);

  const rateNano = session ? parseRate(session.product.rateUsdPerSecond) : 0n;
  const capMs = sub ? sub.maxDurationSeconds * 1000 : 0;
  const ms = sub?.startedAt ? Math.min(elapsedMs({ startedAt: sub.startedAt, now, pausedAt: sub.pausedAt }), capMs) : 0;

  const canStop = view === "held" || ((view === "running" || view === "paused") && !!sub?.subscriberCanStop);
  const canPause = view === "running" && !!session?.product.allowPause && !!sub?.subscriberCanStop;
  const canResume = view === "paused" && !!sub?.subscriberCanStop;

  const act = useCallback(
    (action: Exclude<SignAction, "authorise">) => {
      if (!sub) return;
      setNotice(null);
      // FR-RCT-043: in the frame on this page, or a window if the frame cannot do Face ID.
      // Synchronous, because a window must open inside the click that asked for it.
      const result = request({ action });
      setBusy(action);
      result.then(
        (r) => {
          const event = { subscription: r.subscription, txHash: r.txHash, explorerUrl: explorerUrl(r.txHash, sub.chainId) };
          config.cues.play(r.step === "resumed" ? "started" : "stopped");
          if (r.step === "stopped") handlersRef.current.onStopped?.(event);
          if (r.step === "paused") handlersRef.current.onPaused?.(event);
          if (r.step === "resumed") handlersRef.current.onResumed?.(event);
          setBusy(null);
          read();
        },
        (e: unknown) => {
          setBusy(null);
          setNotice(e instanceof SignatureError ? e.message : "Something went wrong.");
          if (!(e instanceof SignatureError && e.reason === "closed")) handlersRef.current.onError?.(e as Error);
        },
      );
    },
    [request, sub, read, config],
  );

  const receipt: MeterReceipt | null =
    view === "ended" && sub
      ? {
          seconds: sub.secondsElapsed,
          paid: formatAmount(parseRate(sub.settledUsd)),
          returned: formatAmount((() => { const r = parseRate(sub.maxEscrowUsd) - parseRate(sub.settledUsd); return r < 0n ? 0n : r; })()),
          startedAt: sub.startedAt,
          endedAt: null,
          endedReason: sub.endedReason ?? "canceled",
        }
      : null;

  return {
    modal,
    view,
    session,
    error,
    notice,
    busy,
    elapsed: formatElapsed(ms),
    accrued: formatUsd(accruedNano(rateNano, ms), 3),
    held: held && sub ? { amount: formatAmount(parseRate(sub.fundedUsd)), startBy: sub.startBy } : null,
    canStop,
    canPause,
    canResume,
    merchantControlled: !!sub && !sub.subscriberCanStop && (view === "running" || view === "paused"),
    stop: () => act("cancel"),
    pause: () => act("pause"),
    resume: () => act("resume"),
    receipt,
  };
}
