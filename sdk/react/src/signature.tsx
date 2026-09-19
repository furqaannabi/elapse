/**
 * One signature attempt, in a frame first and a window if it must be (FR-RCT-043/044,
 * ADR 2026-09-19).
 *
 * `<Authorize>` and `<Meter>` both ask for signatures, and neither should care where the
 * subscriber gives one. `useSignature` owns that: it returns `request()` for the hooks and a
 * `modal` element for the components to render. The modal holds an iframe of Elapse's page; a
 * result is accepted only from Elapse's origin, that frame's window, and this attempt's nonce
 * (BR-RCT-004) — the same check the popup makes.
 *
 * The handoff is the interesting part. Browsers block passkey enrolment in a cross-origin frame,
 * so a subscriber who has never used Elapse cannot enrol there; the framed page says so with
 * `elapse:needs-window` and the attempt continues in a popup **with the same nonce**. A frame that
 * never loads does the same, as does the subscriber asking for a window. After a handoff the
 * frame's messages are ignored: one attempt resolves once.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  newSignatureNonce,
  requestSignature,
  signatureUrl,
  SignatureError,
  type PopupResult,
  type SignAction,
  type SignStep,
} from "./popup";
import { useElapseConfig } from "./provider";

/** How long a frame has to load before the attempt moves to a window. */
const FRAME_LOAD_TIMEOUT_MS = 8_000;
const STEPS: readonly SignStep[] = ["authorised", "stopped", "paused", "resumed"];

interface Attempt {
  action: SignAction;
  capSeconds: number | undefined;
  nonce: string;
  resolve: (r: PopupResult) => void;
  reject: (e: unknown) => void;
}

export interface SignatureRequest {
  action: SignAction;
  capSeconds?: number;
}

export function useSignature(sessionId: string): { request: (o: SignatureRequest) => Promise<PopupResult>; modal: ReactNode } {
  const config = useElapseConfig();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  /** Set when an attempt ends; the focus goes back once the element can take it again. */
  const restoreRef = useRef(false);

  const request = useCallback(
    ({ action, capSeconds }: SignatureRequest) =>
      new Promise<PopupResult>((resolve, reject) => {
        openerRef.current = typeof document === "undefined" ? null : document.activeElement;
        setAttempt({ action, capSeconds, nonce: newSignatureNonce(), resolve, reject });
      }),
    [],
  );

  /** Continue this attempt in a window, and stop listening to the frame. */
  const toWindow = useCallback(
    (a: Attempt) => {
      setAttempt(null);
      const { result } = requestSignature({
        appOrigin: config.appOrigin,
        session: sessionId,
        action: a.action,
        nonce: a.nonce,
        ...(a.capSeconds === undefined ? {} : { capSeconds: a.capSeconds }),
        ...(config.popupHost ? { host: config.popupHost } : {}),
      });
      result.then(a.resolve, a.reject);
    },
    [config, sessionId],
  );

  const dismiss = useCallback((a: Attempt) => {
    setAttempt(null);
    a.reject(new SignatureError("closed"));
  }, []);

  // The frame's messages, the load deadline, Escape, focus and the page's scroll all live for
  // exactly as long as one attempt does.
  useEffect(() => {
    if (!attempt) return;
    let live = true;

    const onMessage = (event: MessageEvent) => {
      if (!live) return;
      if (event.origin !== new URL(config.appOrigin).origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const d = event.data as Record<string, unknown> | null;
      if (!d || d.nonce !== attempt.nonce) return;
      if (d.type === "elapse:needs-window") {
        live = false;
        toWindow(attempt);
        return;
      }
      if (d.type !== "elapse:result") return;
      if (!STEPS.includes(d.step as SignStep) || typeof d.subscription !== "string" || typeof d.txHash !== "string") return;
      live = false;
      setAttempt(null);
      attempt.resolve({ step: d.step as SignStep, subscription: d.subscription, txHash: d.txHash });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && live) {
        live = false;
        dismiss(attempt);
      }
    };

    // A frame that never loads is a frame the subscriber cannot use.
    const deadline = setTimeout(() => {
      if (live) {
        live = false;
        toWindow(attempt);
      }
    }, FRAME_LOAD_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      live = false;
      clearTimeout(deadline);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Not here: the element that opened this is usually still disabled at cleanup ("Waiting for
      // Face ID…"), and a disabled element cannot take focus. The effect below does it once the
      // component has re-rendered.
      restoreRef.current = true;
    };
  }, [attempt, config, toWindow, dismiss]);

  useEffect(() => {
    if (attempt || !restoreRef.current) return;
    const el = openerRef.current as (HTMLElement & { disabled?: boolean }) | null;
    if (!el?.isConnected || el.disabled) return; // try again on the next render
    restoreRef.current = false;
    el.focus();
  });

  const modal = attempt ? (
    <div className="elapse elapse-modal" role="dialog" aria-modal="true" aria-label="Authorise with Elapse">
      <div className="elapse-modal-backdrop" onClick={() => dismiss(attempt)} aria-hidden="true" />
      <div className="elapse-modal-panel" ref={panelRef} tabIndex={-1}>
        <iframe
          ref={frameRef}
          className="elapse-modal-frame"
          title="Elapse"
          allow="publickey-credentials-get *; payment *"
          src={signatureUrl({
            appOrigin: config.appOrigin,
            session: sessionId,
            action: attempt.action,
            nonce: attempt.nonce,
            mode: "frame",
            publishableKey: config.publishableKey,
            ...(attempt.capSeconds === undefined ? {} : { capSeconds: attempt.capSeconds }),
          })}
        />
        <div className="elapse-modal-foot">
          <button type="button" className="elapse-modal-link" onClick={() => toWindow(attempt)}>
            Having trouble? Open a window
          </button>
          <button type="button" className="elapse-modal-link" onClick={() => dismiss(attempt)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { request, modal };
}
