/**
 * `<Meter session="cs_…">` — the running meter inside the merchant's page (FR-RCT-020/021/022): the
 * ticking readout, the controls the start mode allows, the held state, and the receipt. Markup only;
 * everything else is `useMeter`. No chain words (BR-RCT-001); Stop is a neutral outline (BR-RCT-006).
 */
import { formatCap } from "./money";
import { useElapseConfig } from "./provider";
import { TxLink } from "./tx-link";
import { useMeter, type MeterHandlers } from "./use-meter";
import { useState } from "react";

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
  ...handlers
}: { session: string; dock?: MeterDock; controls?: boolean; proof?: boolean } & MeterHandlers) {
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
  const canPause = controls && m.canPause;
  const canResume = controls && m.canResume;
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
        {(canStop || canPause || canResume) && (
          <div className="elapse-capsule elapse-capsule-actions">
            {canResume && (
              <button type="button" className="elapse-capsule-button" onClick={m.resume} disabled={m.busy !== null}>
                {m.busy === "resume" ? "Resuming…" : "Resume"}
              </button>
            )}
            {canPause && (
              <button type="button" className="elapse-capsule-button" onClick={m.pause} disabled={m.busy !== null}>
                {m.busy === "pause" ? "Pausing…" : "Pause"}
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
  return (
    <>
    {drop}
    <div className="elapse elapse-card" aria-live="polite">
      <p className="elapse-label">
        {s.product.name} · <span className="elapse-numerals">${s.product.rateUsdPerSecond}/s</span>
      </p>
      <div className="elapse-readout" data-running={!paused}>
        <span className="elapse-numerals elapse-elapsed">{m.elapsed}</span>
        <span className="elapse-numerals elapse-accrued">{m.accrued}</span>
      </div>
      <p className="elapse-muted">{paused ? "Paused" : "Running"}</p>
      {m.merchantControlled && sub && (
        <p className="elapse-muted">
          {s.merchant.name} stops this meter. It ends by itself at your {formatCap(sub.maxDurationSeconds)}.
        </p>
      )}
      {notice}
      <div className="elapse-actions">
        {mute}
        {canResume && (
          <button type="button" className="elapse-primary" onClick={m.resume} disabled={m.busy !== null}>
            {m.busy === "resume" ? "Resuming…" : "Resume"}
          </button>
        )}
        {canPause && (
          <button type="button" className="elapse-outline" onClick={m.pause} disabled={m.busy !== null}>
            {m.busy === "pause" ? "Pausing…" : "Pause"}
          </button>
        )}
        {canStop && (
          <button type="button" className="elapse-outline" onClick={m.stop} disabled={m.busy !== null}>
            {m.busy === "cancel" ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
    </div>
    </>
  );
}
