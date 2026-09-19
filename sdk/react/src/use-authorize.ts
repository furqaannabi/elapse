/**
 * `useAuthorize(session)` — the authorise flow without markup (FR-RCT-030). `<Authorize>` is built only
 * from this hook. It reads the public session, and `authorise(cap)` asks for a signature — in a modal
 * frame, or a window when the frame cannot do Face ID (FR-RCT-011/043) — then reports what came back
 * (FR-RCT-013/014/031). `modal` is the element the component must render for the frame to exist.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { explorerUrl } from "./explorer";
import { SignatureError } from "./popup";
import { useSignature } from "./signature";
import { useElapseConfig } from "./provider";
import { fetchPublicSession, type PublicSession } from "./session";

export interface StepEvent {
  subscription: string;
  txHash: string;
  explorerUrl: string;
}

export type AuthorizeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: PublicSession; notice: string | null }
  | { kind: "authorising"; session: PublicSession }
  | { kind: "held"; session: PublicSession; event: StepEvent }
  | { kind: "started"; session: PublicSession; event: StepEvent };

export function useAuthorize(
  sessionId: string,
  handlers: { onAuthorised?: (e: StepEvent) => void; onStarted?: (e: StepEvent) => void; onError?: (e: Error) => void } = {},
) {
  const config = useElapseConfig();
  // FR-RCT-043: the signature happens in a frame on this page, or in a window if it must.
  const { request, modal } = useSignature(sessionId);
  const [state, setState] = useState<AuthorizeState>({ kind: "loading" });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let alive = true;
    fetchPublicSession(config, sessionId)
      .then((session) => alive && setState({ kind: "ready", session, notice: null }))
      .catch((e: Error) => {
        if (!alive) return;
        setState({ kind: "error", message: e.message });
        handlersRef.current.onError?.(e);
      });
    return () => {
      alive = false;
    };
  }, [config, sessionId]);

  const authorise = useCallback(
    (capSeconds: number) => {
      if (state.kind !== "ready") return;
      const session = state.session;
      // Synchronous: a window, if this attempt needs one, must open inside the click that called this.
      const result = request({ action: "authorise", capSeconds });
      setState({ kind: "authorising", session });
      result.then(
        (r) => {
          const event = { subscription: r.subscription, txHash: r.txHash, explorerUrl: explorerUrl(r.txHash) };
          // FR-RCT-050: one cue, on the transition, never on a tick.
          config.cues.play(session.product.startMode === "merchant" ? "authorised" : "started");
          if (session.product.startMode === "merchant") {
            setState({ kind: "held", session, event });
            handlersRef.current.onAuthorised?.(event);
          } else {
            setState({ kind: "started", session, event });
            handlersRef.current.onStarted?.(event);
          }
        },
        (e: unknown) => {
          const message = e instanceof SignatureError ? e.message : "Something went wrong. Nothing was charged.";
          setState({ kind: "ready", session, notice: message });
          if (!(e instanceof SignatureError && e.reason === "closed")) handlersRef.current.onError?.(e as Error);
        },
      );
    },
    [request, state],
  );

  return { state, authorise, modal };
}
