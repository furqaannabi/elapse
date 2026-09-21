/**
 * `AuthorizePage` — the Elapse popup `@elapse/react` opens for every signature (checkout
 * FR-CHK-038/039, ADR 2026-09-17 React SDK). It runs on Elapse's origin, so the subscriber's wallet
 * never runs under merchant code (BR-RCT-003).
 *
 * One action per window: sign in if needed, set the cap and add funds when authorising, confirm,
 * submit, then post `{ step, subscription, txHash, nonce }` to the origin of the session's
 * `success_url` and close. With no opener it shows the result and says the window can be closed.
 * Built from the hosted checkout's own parts (DESIGN.md, no new direction).
 */
"use client";

import { Mail, ScanFace } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AddMoneyStep } from "@/components/checkout/add-money-step";
import { CheckoutFrame } from "@/components/checkout/checkout-frame";
import { FaceIdSheet } from "@/components/checkout/face-id-sheet";
import { useAuthFlow, type AuthResult } from "@/lib/checkout/auth-flow";
import { getCheckoutApi } from "@/lib/checkout/client";
import { formatReceiptUsd, maxEscrowNano, parseUsd } from "@/lib/checkout/funding";
import { CheckoutApiError, type SubmitAction } from "@/lib/checkout/mock-api";
import type { CheckoutBalance, CheckoutSession } from "@/lib/checkout/types";
import { postResult, resultTargetOrigin, type ResultStep } from "@/lib/authorize/result";
import { parseRate } from "@/lib/meter/math";

const STEP: Record<SubmitAction, ResultStep> = { authorise: "authorised", cancel: "stopped" };
const ACTIONS = Object.keys(STEP) as SubmitAction[];

type Opener = { postMessage(message: unknown, targetOrigin: string): void } | null;

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; session: CheckoutSession }
  | { kind: "funds"; session: CheckoutSession; balance: CheckoutBalance; neededUsd: string }
  | { kind: "error"; session: CheckoutSession | null; message: string }
  | { kind: "done"; session: CheckoutSession; posted: boolean };

export function AuthorizePage({
  session: sessionId,
  action: rawAction,
  cap,
  nonce,
  mode,
  signedIn: signedInProp,
  opener = typeof window === "undefined" ? null : ((window.opener ?? window.parent) as Opener),
  close = () => window.close(),
}: {
  session: string;
  action: string;
  cap?: string;
  nonce: string;
  /** `frame` when `@elapse/react` renders this page in its modal (FR-RCT-043). */
  mode?: string;
  /** Injected in tests; otherwise read from the wallet flow. */
  signedIn?: boolean;
  /** Injected in tests; the window that opened this page — the opener, or the parent in a frame. */
  opener?: Opener;
  close?: () => void;
}) {
  const action = (ACTIONS as string[]).includes(rawAction) ? (rawAction as SubmitAction) : null;
  const capSeconds = cap && /^\d{2,7}$/.test(cap) ? Number(cap) : null;
  const valid = action !== null && /^cs_[A-Za-z0-9]+$/.test(sessionId) && /^[A-Za-z0-9]{1,64}$/.test(nonce) && (action !== "authorise" || capSeconds !== null);

  const api = getCheckoutApi(sessionId);
  const flow = useAuthFlow();
  const [state, setState] = useState<State>(valid ? { kind: "loading" } : { kind: "invalid" });
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    api
      .getSession(sessionId)
      .then((session) => alive && setState({ kind: "ready", session }))
      .catch((e: unknown) => alive && setState({ kind: "error", session: null, message: e instanceof Error ? e.message : "Something went wrong." }));
    return () => {
      alive = false;
    };
  }, [api, sessionId, valid]);

  const session = state.kind === "loading" || state.kind === "invalid" ? null : state.session;
  const signedIn = !!(session?.customer || session?.signedIn);

  const signIn = useCallback(
    async (r: AuthResult) => {
      setAuthOpen(false);
      try {
        setState({ kind: "ready", session: await api.signIn(sessionId, r) });
      } catch (e) {
        setState({ kind: "error", session, message: e instanceof Error ? e.message : "Could not sign you in." });
      }
    },
    [api, sessionId, session],
  );

  // A device that already holds a sign-in goes straight on, as on the hosted checkout.
  const silent = useRef(false);
  useEffect(() => {
    if (!flow.signedInAlready || silent.current || state.kind !== "ready" || signedIn) return;
    silent.current = true;
    void Promise.resolve().then(() => signIn({}));
  }, [flow.signedInAlready, state.kind, signedIn, signIn]);

  /**
   * FR-CHK-038 (amended 2026-09-19): in a frame, Face ID is only half available. Browsers allow an
   * existing passkey to be used inside a cross-origin frame but refuse to enrol a new one, so a
   * subscriber without a session cannot get through here at all. Rather than let them meet a
   * failure they cannot act on, the page says so and `@elapse/react` reopens the same attempt in a
   * window (FR-RCT-043). Signed in, the frame is the better place and we stay.
   */
  const framed = mode === "frame";
  // The session's own answer, unless a test says otherwise. A wallet this device already holds
  // (`flow.signedInAlready`) counts too: it needs no enrolment.
  const hasSession = signedInProp ?? (signedIn || !!flow.signedInAlready);
  const askedForWindow = useRef(false);
  const askForWindow = useCallback(() => {
    if (askedForWindow.current || !session) return;
    const target = resultTargetOrigin(session.merchant.successUrl);
    if (!opener || !target) return;
    askedForWindow.current = true;
    opener.postMessage({ type: "elapse:needs-window", nonce }, target);
  }, [opener, session, nonce]);

  useEffect(() => {
    if (framed && session && !hasSession) askForWindow();
  }, [framed, session, hasSession, askForWindow]);

  const confirm = async () => {
    if (!action || !session) return;
    setBusy(true);
    try {
      let current = session;
      if (action === "authorise" && capSeconds !== null) {
        if (current.subscription?.maxDurationSeconds !== capSeconds) current = await api.setCap(sessionId, capSeconds);
        const needed = maxEscrowNano(capSeconds, parseRate(current.product.rateUsdPerSecond));
        const balance = await api.getBalance(sessionId);
        if (balance.needsFunding && parseUsd(balance.balanceUsd) < needed) {
          setState({ kind: "funds", session: current, balance, neededUsd: formatReceiptUsd(needed) });
          return;
        }
      }
      const r = await api.submit(sessionId, action);
      const posted = postResult({ opener, successUrl: current.merchant.successUrl, step: STEP[action], subscription: r.subscription, txHash: r.txHash, nonce });
      setState({ kind: "done", session: current, posted });
      if (posted) setTimeout(close, 900);
    } catch (e) {
      const message = e instanceof CheckoutApiError || e instanceof Error ? e.message : "Something went wrong.";
      setState({ kind: "error", session, message });
    } finally {
      setBusy(false);
    }
  };

  const merchant = session?.merchant ?? { name: "Elapse" };
  const heading = (() => {
    if (!session || !action) return "";
    if (action === "authorise" && capSeconds !== null) {
      return `Authorise up to $${formatReceiptUsd(maxEscrowNano(capSeconds, parseRate(session.product.rateUsdPerSecond)))} for ${session.merchant.name}`;
    }
    return { cancel: `Stop your meter at ${session.merchant.name}?`, pause: `Pause your meter at ${session.merchant.name}?`, resume: `Resume your meter at ${session.merchant.name}?` }[action as Exclude<SubmitAction, "authorise">];
  })();

  return (
    <CheckoutFrame merchant={merchant}>
      <section className="flex flex-1 flex-col justify-center gap-6 py-8" aria-live="polite">
        {state.kind === "loading" && <p className="text-ink-soft">One moment…</p>}

        {state.kind === "invalid" && <p className="text-lg">This link is not valid.</p>}

        {state.kind === "ready" && !signedIn && (
          <>
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">{heading}</h1>
            <Button size="lg" onClick={() => setAuthOpen(true)} disabled={flow.ready === false} className="h-12 w-full text-base">
              {flow.passkeyFirst ? <ScanFace data-icon="inline-start" className="size-5" /> : <Mail data-icon="inline-start" className="size-5" />}
              {flow.passkeyFirst ? "Continue with Face ID" : "Continue with email"}
            </Button>
            <FaceIdSheet open={authOpen} onOpenChange={setAuthOpen} merchantName={merchant.name} onAuthenticated={signIn} resume={flow.resumed ?? null} />
          </>
        )}

        {state.kind === "ready" && signedIn && (
          <>
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">{heading}</h1>
            {action === "authorise" && <p className="text-ink-soft">You only pay the seconds you use.</p>}
            <Button size="lg" onClick={confirm} disabled={busy} className="h-12 w-full text-base">
              <ScanFace data-icon="inline-start" className="size-5" />
              {busy ? "Confirming…" : "Confirm with Face ID"}
            </Button>
          </>
        )}

        {/*
          * FR-CHK-038: in a frame, a quiet way out. Face ID inside a cross-origin frame works only
          * for a passkey this device already holds, and the subscriber cannot be expected to know
          * that — so the escape is always one press away, not a thing they must discover.
          */}
        {framed && state.kind === "ready" && (
          <button type="button" onClick={askForWindow} className="mx-auto min-h-11 text-sm text-ink-soft underline-offset-4 hover:underline">
            Having trouble? Open a window
          </button>
        )}

        {state.kind === "funds" && (
          <AddMoneyStep
            neededUsd={state.neededUsd}
            initial={state.balance}
            refresh={() => api.getBalance(sessionId)}
            onFunded={() => setState({ kind: "ready", session: state.session })}
            cancelHref={state.session.merchant.cancelUrl}
          />
        )}

        {state.kind === "error" && (
          <>
            <p className="text-lg">{state.message}</p>
            {state.session && (
              <Button size="lg" variant="outline" onClick={() => setState({ kind: "ready", session: state.session! })} className="h-12 w-full text-base">
                Try again
              </Button>
            )}
          </>
        )}

        {state.kind === "done" && (
          <>
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">
              {state.posted ? `Done. Returning you to ${state.session.merchant.name}.` : "Done."}
            </h1>
            {!state.posted && <p className="text-ink-soft">You can close this window.</p>}
          </>
        )}
      </section>
    </CheckoutFrame>
  );
}
