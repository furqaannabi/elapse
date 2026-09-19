/**
 * `<Authorize session="cs_…">` — the cap step inside the merchant's page (FR-RCT-010): 1 hour and
 * 4 hours with what each can cost, the checkout's own copy (and the merchant-mode lines), and one
 * Authorise button that opens the Elapse popup. Markup only; the flow is `useAuthorize`.
 *
 * Maps to: FR-RCT-010/011/013/014; checkout FR-CHK-003/034/035/037 copy; BR-RCT-001 (no chain words).
 */
import { useState } from "react";
import { CAP_PRESETS_SECONDS, escrowNano, formatAmount, formatCap } from "./money";
import { useAuthorize, type StepEvent } from "./use-authorize";

export function Authorize({
  session,
  onAuthorised,
  onStarted,
  onError,
}: {
  session: string;
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
