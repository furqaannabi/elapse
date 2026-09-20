/**
 * `<Authorize session="cs_…">` — the cap step inside the merchant's page (FR-RCT-010): 1 hour and
 * 4 hours with what each can cost, the checkout's own copy (and the merchant-mode lines), and one
 * Authorise button that opens the Elapse popup. Markup only; the flow is `useAuthorize`.
 *
 * Maps to: FR-RCT-010/011/013/014; checkout FR-CHK-003/034/035/037 copy; BR-RCT-001 (no chain words).
 */
import { useEffect, useRef, useState } from "react";
import { CAP_PRESETS_SECONDS, escrowNano, formatAmount, formatCap } from "./money";
import { useAuthorize, type StepEvent } from "./use-authorize";

export function Authorize({
  session,
  cap: fixedCap,
  onAuthorised,
  onStarted,
  onError,
}: {
  session: string;
  /**
   * FR-RCT-010 (amended 2026-09-20): the merchant chooses the cap and the subscriber is not asked.
   * No cap step renders and the signature is asked for as soon as the session is read — one accept,
   * in the Elapse window, instead of two. `examples/lambda` passes `MAX_DURATION_SECONDS`.
   */
  cap?: number;
  onAuthorised?: (e: StepEvent) => void;
  onStarted?: (e: StepEvent) => void;
  onError?: (e: Error) => void;
}) {
  const { state, authorise, modal } = useAuthorize(session, {
    ...(onAuthorised ? { onAuthorised } : {}),
    ...(onStarted ? { onStarted } : {}),
    ...(onError ? { onError } : {}),
  });
  const [cap, setCap] = useState<number>(CAP_PRESETS_SECONDS[0]);

  // Asked once: a re-render must not open a second window (FR-RCT-011).
  const asked = useRef(false);
  useEffect(() => {
    if (fixedCap === undefined || asked.current || state.kind !== "ready") return;
    asked.current = true;
    authorise(fixedCap);
  }, [fixedCap, state.kind, authorise]);

  if (state.kind === "loading") return <>{modal}<div className="elapse elapse-card" aria-busy="true" /></>;
  if (state.kind === "error") return <>{modal}<div className="elapse elapse-card" role="alert">{state.message}</div></>;

  const s = state.session;
  if (state.kind === "held") {
    return (
      <>
        {modal}
        <div className="elapse elapse-card" aria-live="polite">
          <h2 className="elapse-title">Waiting for {s.merchant.name} to start</h2>
          <p className="elapse-muted">You haven&rsquo;t been charged.</p>
        </div>
      </>
    );
  }
  if (state.kind === "started") {
    return (
      <>
        {modal}
        <div className="elapse elapse-card" aria-live="polite">
          <h2 className="elapse-title">Your meter is running</h2>
        </div>
      </>
    );
  }

  // With a merchant-chosen cap there is nothing to ask: the Elapse window is the only accept.
  if (fixedCap !== undefined) {
    const blockedNow = state.kind === "ready" && state.notice !== null && state.notice.startsWith("Your browser blocked");
    return (
      <>
        {modal}
        <div className="elapse elapse-card" aria-live="polite" {...(blockedNow ? {} : { "aria-busy": true })}>
          {blockedNow ? (
            <>
              <p className="elapse-notice" role="status">{state.notice}</p>
              <button type="button" className="elapse-primary" onClick={() => authorise(fixedCap)}>
                Try again
              </button>
            </>
          ) : (
            <p className="elapse-muted">Waiting for Face ID&hellip;</p>
          )}
        </div>
      </>
    );
  }

  const merchantMode = s.product.startMode === "merchant";
  const busy = state.kind === "authorising";
  const notice = state.kind === "ready" ? state.notice : null;
  const blocked = notice !== null && notice.startsWith("Your browser blocked");

  return (
    <>
      {modal}
      <div className="elapse elapse-card">
      <p className="elapse-label">How long may the meter run?</p>
      <div className="elapse-presets" role="radiogroup" aria-label="How long">
        {CAP_PRESETS_SECONDS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            role="radio"
            aria-checked={cap === seconds}
            className="elapse-preset"
            onClick={() => setCap(seconds)}
            disabled={busy}
          >
            <span className="elapse-preset-cap">{formatCap(seconds)}</span>
            <span className="elapse-numerals"> · Up to {formatAmount(escrowNano(s.product.rateUsdPerSecond, seconds))}</span>
          </button>
        ))}
      </div>
      <p className="elapse-muted">You only pay the seconds you use. Anything unused comes back when you stop.</p>
      {merchantMode && (
        <>
          <p className="elapse-muted">Billing starts when {s.merchant.name} starts your session.</p>
          <p className="elapse-muted">
            Only {s.merchant.name} can stop this meter. It ends by itself at your {formatCap(cap)} at the latest.
          </p>
        </>
      )}
      {notice && (
        <p className="elapse-notice" role="status">
          {notice}
        </p>
      )}
      <button type="button" className="elapse-primary" onClick={() => authorise(cap)} disabled={busy}>
        {busy ? "Waiting for Face ID…" : blocked ? "Try again" : "Authorise"}
      </button>
      </div>
    </>
  );
}
