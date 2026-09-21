/**
 * `<Meter session="cs_…">` — the running meter inside the merchant's page (FR-RCT-020/021/022): the
 * ticking readout, the controls the start mode allows, the held state, and the receipt. Markup only;
 * everything else is `useMeter`. No chain words (BR-RCT-001); Stop is a neutral outline (BR-RCT-006).
 */
import { ask, clearWhen, type AskState } from "./ask";

/** How often the meter re-reads while it waits for an approved request to land on chain. */
const FOLLOW_UP_MS = 1_000;
/** And for how long: a pause that never confirms is the merchant's problem to report, not a poll loop. */
const FOLLOW_UP_LIMIT_MS = 10_000;
import { formatCap } from "./money";
import { useElapseConfig } from "./provider";
import { TxLink } from "./tx-link";
import { useMeter, type MeterHandlers } from "./use-meter";
import { useEffect, useState } from "react";

/**
 * FR-RCT-041: the mark that says it is done. A checkmark that draws itself once, the way a payment
 * sheet's does — the motion is in the stylesheet, so `prefers-reduced-motion` simply shows it.
 */
function Tick() {
  return (
    <svg className="elapse-tick" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 12.5 L10 18.5 L20 6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Where a docked meter sits. Omit it and the meter renders inline, as it always has. */
export type MeterDock = "bottom-right" | "bottom-left";

/**
 * FR-RCT-045: the proof of one step, dropped out of the meter.
 *
 * **Amended 2026-09-20 (Furqaan: "don't disappear hashes"):** it stays for as long as the meter is
 * on screen. It used to lift away after six seconds, which was fine when a session ran for minutes;
 * with `examples/lambda` ending the session with its run (FR-EXM-153), the whole session can be
 * shorter than that, and the proof of both ends vanished while it was still being read.
 */
function ProofDrop({ step, txHash, chainId }: { step: "started" | "stopped"; txHash: string; chainId: number }) {
  return (
    <div className="elapse-proof" aria-live="polite">
      <span className="elapse-proof-step">{step === "started" ? "Meter started" : "Meter stopped"}</span>
      <TxLink hash={txHash} chainId={chainId} />
    </div>
  );
}

export function Meter({
  session,
  dock,
  controls = true,
  proof = false,
  onPauseRequest,
  onResumeRequest,
  ...handlers
}: {
  session: string;
  dock?: MeterDock;
  controls?: boolean;
  proof?: boolean;
  /**
   * FR-RCT-021 (amended 2026-09-20): a subscriber cannot pause a meter — only the merchant can
   * (ADR 2026-09-20). Pass these and the meter offers Pause and Resume as **requests**: the button
   * calls your handler, nothing is signed and nothing reaches Elapse. Your server decides and
   * pauses with `subscriptions.pause`. Omit them and no such control renders.
   */
  onPauseRequest?: () => void | Promise<void>;
  onResumeRequest?: () => void | Promise<void>;
} & MeterHandlers) {
  const m = useMeter(session, handlers);
  // FR-RCT-042 (amended 2026-09-19, Furqaan: "no stop button"): a merchant whose meter is its own
  // to stop can turn the subscriber's controls off entirely. The escrow is untouched by this — the
  // held session still refunds by itself (worker FR-WRK-075) and the merchant can still cancel.
  // BR-RCT-001: no hash reaches a subscriber unless the merchant asked for one.
  const drop =
    proof && m.proof.length > 0 && m.session?.subscription ? (
      <>
        {m.proof.map((p) => (
          <ProofDrop key={p.txHash} step={p.step} txHash={p.txHash} chainId={m.session!.subscription!.chainId} />
        ))}
      </>
    ) : null;
  const canStop = controls && m.canStop;
  // Asking is not doing: these render only because the merchant offered to listen (FR-RCT-021 amended).
  const canAskPause = controls && !!onPauseRequest && m.view === "running" && !!m.session?.product.allowPause;
  const canAskResume = controls && !!onResumeRequest && m.view === "paused";
  // FR-RCT-046: the merchant decides over their own wire, so the meter cannot poll for an answer.
  // What it can do is say who was asked and what they said, until its own view agrees.
  const [asked, setAsked] = useState<AskState | null>(null);
  if (asked && clearWhen(asked, m.view)) setAsked(null);
  const request = (want: "pause" | "resume", handler: (() => void | Promise<void>) | undefined) => () => {
    if (handler) void ask(want, m.session?.merchant.name ?? "the merchant", handler, setAsked);
  };
  // FR-RCT-046 (amended): follow an approved request instead of waiting out the 5 s poll. The
  // merchant's answer says only that they asked the chain; the meter still has to see it land, and
  // until it does it keeps ticking and keeps offering the control the subscriber just used.
  const following = !!asked && !asked.pending && asked.want !== null;
  useEffect(() => {
    if (!following) return;
    const id = setInterval(m.refresh, FOLLOW_UP_MS);
    const stop = setTimeout(() => clearInterval(id), FOLLOW_UP_LIMIT_MS);
    m.refresh();
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [following, m.refresh]);
  const askedLine = asked ? <p className="elapse-asked">{asked.line}</p> : null;
  const { cues } = useElapseConfig();
  const [muted, setMuted] = useState(() => cues.muted());
  // FR-RCT-050: the subscriber's own switch, remembered by the browser.
  const mute = (
    <button
      type="button"
      className="elapse-mute"
      aria-pressed={muted}
      aria-label={muted ? "Turn meter sounds on" : "Turn meter sounds off"}
      onClick={() => {
        cues.setMuted(!muted);
        setMuted(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );

  /**
   * FR-RCT-042: the docked capsule. One pill in the corner — a live dot, the elapsed clock, the
   * amount — because a subscriber watching their own money spend needs to read it at a glance, not
   * study a card. Controls, when the product allows any, are a second pill beneath it. The dot
   * marks running or paused; nothing here animates per second (BR-CHK-002).
   */
  if (dock) {
    if (m.view === "loading" || m.view === "error") return null;
    const running = m.view === "running";
    const r = m.receipt;
    return (
      <>
      <div className={`elapse elapse-dock`} data-corner={dock} data-running={running} aria-live="polite">
        {drop}
        <div className="elapse-capsule">
          <span className="elapse-dot" aria-hidden="true" />
          {m.view === "ended" && r ? (
            <span className="elapse-numerals elapse-capsule-amount">
              <Tick /> You paid for {r.seconds} {r.seconds === 1 ? "second" : "seconds"} · {r.paid}
            </span>
          ) : m.view === "held" && m.held ? (
            <span className="elapse-numerals elapse-capsule-amount">{m.held.amount} held</span>
          ) : (
            <>
              <span className="elapse-numerals elapse-capsule-elapsed">{m.elapsed}</span>
              <span className="elapse-numerals elapse-capsule-amount">{m.accrued}</span>
              {mute}
            </>
          )}
        </div>
        {askedLine}
        {(canStop || canAskPause || canAskResume) && (
          <div className="elapse-capsule elapse-capsule-actions">
            {canAskResume && (
              <button type="button" className="elapse-capsule-button" onClick={request("resume", onResumeRequest)} disabled={asked?.pending === true}>
                Resume
              </button>
            )}
            {canAskPause && (
              <button type="button" className="elapse-capsule-button" onClick={request("pause", onPauseRequest)} disabled={asked?.pending === true}>
                Pause
              </button>
            )}
            {canStop && (
              <button type="button" className="elapse-capsule-button" onClick={m.stop} disabled={m.busy !== null}>
                {m.busy === "cancel" ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
        )}
      </div>
      </>
    );
  }

  if (m.view === "loading") return <div className="elapse elapse-card" aria-busy="true" />;
  if (m.view === "error") return <div className="elapse elapse-card" role="alert">{m.error}</div>;
  const s = m.session!;
  const sub = s.subscription;

  const notice = m.notice && (
    <p className="elapse-notice" role="status">
      {m.notice}
    </p>
  );

  if (m.view === "waiting") {
    return (
      <>
      <div className="elapse elapse-card" aria-live="polite">
        <p className="elapse-muted">Your meter hasn&rsquo;t started yet.</p>
      </div>
      </>
    );
  }

  if (m.view === "held" && m.held) {
    return (
      <>
      <div className="elapse elapse-card" aria-live="polite">
        <h2 className="elapse-title">Waiting for {s.merchant.name} to start</h2>
        <p className="elapse-numerals">{m.held.amount} held · You haven&rsquo;t been charged.</p>
        {m.held.startBy && <p className="elapse-muted">If it hasn&rsquo;t started by {clock(m.held.startBy)}, it all comes back to you.</p>}
        {notice}
        {canStop && (
          <button type="button" className="elapse-outline" onClick={m.stop} disabled={m.busy !== null}>
            {m.busy === "cancel" ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      </>
    );
  }

  if (m.view === "ended" && m.receipt) {
    const r = m.receipt;
    return (
      <>
      {drop}
      <div className="elapse elapse-card" aria-live="polite">
        <h2 className="elapse-title">
          <Tick /> You paid for {r.seconds} {r.seconds === 1 ? "second" : "seconds"} · {r.paid}
        </h2>
        <dl className="elapse-receipt">
          {r.startedAt !== null && (
            <>
              <dt>Started</dt>
              <dd className="elapse-numerals">{clock(r.startedAt)}</dd>
            </>
          )}
          <dt>Charged</dt>
          <dd className="elapse-numerals">{r.paid}</dd>
          <dt>Returned to you</dt>
          <dd className="elapse-numerals">{r.returned}</dd>
        </dl>
      </div>
      </>
    );
  }

  const paused = m.view === "paused";
  const e = m.elapsedParts;
  return (
    <>
    {drop}
    <div className="elapse elapse-card elapse-meter" aria-live="polite">
      {/* The header of the meter on elapse.finance: who and what, then the rate. */}
      <div className="elapse-meter-head">
        <span className="elapse-placard">{s.merchant.name} · {s.product.name}</span>
        <span className="elapse-numerals elapse-rate">${s.product.rateUsdPerSecond}/s</span>
      </div>
      <div className="elapse-meter-body">
        <div
          className="elapse-readout"
          data-running={!paused}
          role="timer"
          aria-live="off"
          aria-label={`Elapsed ${e.hours}:${e.minutes}:${e.seconds}, accrued ${m.accrued}`}
        >
          <div className="elapse-numerals elapse-time">
            <span>{e.hours}</span>
            <span className="elapse-colon">:</span>
            <span>{e.minutes}</span>
            <span className="elapse-colon">:</span>
            <span>{e.seconds}</span>
            <span className="elapse-tenths">.{e.tenths}</span>
          </div>
          <div className="elapse-numerals elapse-amount">
            <span>{m.accrued}</span>
            <span className="elapse-dot" aria-hidden />
          </div>
        </div>
        {m.merchantControlled && sub && (
          <p className="elapse-muted">
            {s.merchant.name} stops this meter. It ends by itself at your {formatCap(sub.maxDurationSeconds)}.
          </p>
        )}
        {notice}
        {askedLine}
        <div className="elapse-meter-foot">
          <span className="elapse-muted">{paused ? "Paused" : canStop ? "Running · stop any time" : "Running"}</span>
          <div className="elapse-actions">
            {mute}
            {canAskResume && (
              <button type="button" className="elapse-primary" onClick={request("resume", onResumeRequest)} disabled={asked?.pending === true}>
                Resume
              </button>
            )}
            {canAskPause && (
              <button type="button" className="elapse-outline" onClick={request("pause", onPauseRequest)} disabled={asked?.pending === true}>
                Pause
              </button>
            )}
            {canStop && (
              <button type="button" className="elapse-outline" onClick={m.stop} disabled={m.busy !== null}>
                {m.busy === "cancel" ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
