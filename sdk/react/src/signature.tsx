/**
 * One signature attempt, always in a window (FR-RCT-043/044 amended 2026-09-20,
 * [ADR 2026-09-20](../../../docs/decisions/2026-09-20-authorise-in-a-window-only.md)).
 *
 * `<Authorize>` and `<Meter>` both ask for signatures, and neither should care where the subscriber
 * gives one. `useSignature` owns that: `request()` opens the Elapse page in a window and resolves
 * with what comes back — accepted only from Elapse's origin, that window, and this attempt's nonce
 * (BR-RCT-004).
 *
 * It used to try a modal frame first and hand off to a window when the frame could not enrol a
 * passkey, which meant a subscriber often saw a dimmed panel appear and vanish before the window
 * they actually signed in. Browsers block passkey enrolment in a cross-origin frame, so that
 * handoff was the common path rather than the exception. One window, every time.
 *
 * The window must be opened inside the user's click: `request()` does no `await` before opening, so
 * callers must call it straight from the handler. A blocked window rejects with `blocked`, which the
 * components turn into a notice and a Try again.
 */
import { useCallback } from "react";
import { requestSignature, type PopupResult, type SignAction } from "./popup";
import { useElapseConfig } from "./provider";

export interface SignatureRequest {
  action: SignAction;
  capSeconds?: number;
}

export function useSignature(sessionId: string): { request: (o: SignatureRequest) => Promise<PopupResult> } {
  const config = useElapseConfig();

  const request = useCallback(
    ({ action, capSeconds }: SignatureRequest) =>
      requestSignature({
        appOrigin: config.appOrigin,
        session: sessionId,
        action,
        ...(capSeconds === undefined ? {} : { capSeconds }),
        ...(config.popupHost ? { host: config.popupHost } : {}),
      }).result,
    [config, sessionId],
  );

  return { request };
}
