/**
 * `<Meter session="cs_…">` — the running meter inside the merchant's page (FR-RCT-020/021/022): the
 * ticking readout, the controls the start mode allows, the held state, and the receipt. Markup only;
 * everything else is `useMeter`. No chain words (BR-RCT-001); Stop is a neutral outline (BR-RCT-006).
 */
import { formatCap } from "./money";
import { useMeter, type MeterHandlers } from "./use-meter";

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Where a docked meter sits. Omit it and the meter renders inline, as it always has. */
export type MeterDock = "bottom-right" | "bottom-left";

export function Meter({ session, dock, ...handlers }: { session: string; dock?: MeterDock } & MeterHandlers) {
  const m = useMeter(session, handlers);

  /**
   * FR-RCT-042: the docked capsule. One pill in the corner — a live dot, the elapsed clock, the
   * amount — because a subscriber watching their own money spend needs to read it at a glance, not
   * study a card. Controls, when the product allows any, are a second pill beneath it. The dot
   * marks running or paused; nothing here animates per second (BR-CHK-002).
   */
  if (dock) {
    if (m.view === "loading" || m.view === "error") return <>{m.modal}</>;
    const running = m.view === "running";
    const r = m.receipt;
    return (
      <>
      {m.modal}
      <div className={`elapse elapse-dock`} data-corner={dock} data-running={running} aria-live="polite">
        <div className="elapse-capsule">
          <span className="elapse-dot" aria-hidden="true" />
          {m.view === "ended" && r ? (
            <span className="elapse-numerals elapse-capsule-amount">
              You paid for {r.seconds} {r.seconds === 1 ? "second" : "seconds"} · {r.paid}
            </span>
          ) : m.view === "held" && m.held ? (
            <span className="elapse-numerals elapse-capsule-amount">{m.held.amount} held</span>
          ) : (
            <>
              <span className="elapse-numerals elapse-capsule-elapsed">{m.elapsed}</span>
              <span className="elapse-numerals elapse-capsule-amount">{m.accrued}</span>
            </>
          )}
        </div>
        {(m.canStop || m.canPause || m.canResume) && (
          <div className="elapse-capsule elapse-capsule-actions">
            {m.canResume && (
              <button type="button" className="elapse-capsule-button" onClick={m.resume} disabled={m.busy !== null}>
                {m.busy === "resume" ? "Resuming…" : "Resume"}
              </button>
            )}
            {m.canPause && (
              <button type="button" className="elapse-capsule-button" onClick={m.pause} disabled={m.busy !== null}>
                {m.busy === "pause" ? "Pausing…" : "Pause"}
              </button>
            )}
            {m.canStop && (
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

  if (m.view === "loading") return <>{m.modal}<div className="elapse elapse-card" aria-busy="true" /></>;
  if (m.view === "error") return <>{m.modal}<div className="elapse elapse-card" role="alert">{m.error}</div></>;
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
      {m.modal}
      <div className="elapse elapse-card" aria-live="polite">
        <p className="elapse-muted">Your meter hasn&rsquo;t started yet.</p>
      </div>
      </>
    );
  }

  if (m.view === "held" && m.held) {
    return (
      <>
      {m.modal}
      <div className="elapse elapse-card" aria-live="polite">
        <h2 className="elapse-title">Waiting for {s.merchant.name} to start</h2>
        <p className="elapse-numerals">{m.held.amount} held · You haven&rsquo;t been charged.</p>
        {m.held.startBy && <p className="elapse-muted">If it hasn&rsquo;t started by {clock(m.held.startBy)}, it all comes back to you.</p>}
        {notice}
        <button type="button" className="elapse-outline" onClick={m.stop} disabled={m.busy !== null}>
          {m.busy === "cancel" ? "Stopping…" : "Stop"}
        </button>
      </div>
      </>
    );
  }

  if (m.view === "ended" && m.receipt) {
    const r = m.receipt;
    return (
      <>
      {m.modal}
      <div className="elapse elapse-card" aria-live="polite">
        <h2 className="elapse-title">
          You paid for {r.seconds} {r.seconds === 1 ? "second" : "seconds"} · {r.paid}
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
    {m.modal}
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
        {m.canResume && (
          <button type="button" className="elapse-primary" onClick={m.resume} disabled={m.busy !== null}>
            {m.busy === "resume" ? "Resuming…" : "Resume"}
          </button>
        )}
        {m.canPause && (
          <button type="button" className="elapse-outline" onClick={m.pause} disabled={m.busy !== null}>
            {m.busy === "pause" ? "Pausing…" : "Pause"}
          </button>
        )}
        {m.canStop && (
          <button type="button" className="elapse-outline" onClick={m.stop} disabled={m.busy !== null}>
            {m.busy === "cancel" ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
    </div>
    </>
  );
}
