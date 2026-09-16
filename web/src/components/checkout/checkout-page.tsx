/**
 * `CheckoutPage` — the client orchestrator for `/c/[session]`.
 *
 * Loads the session, re-derives the view every tick, and hands each view
 * to its screen. All money and state rules live in `lib/checkout`; this
 * file only wires actions to the API and decides which sheet is open.
 *
 * The subscriber authorises a cap once (FR-CHK-003); the meter ends when
 * that cap is used up (FR-CHK-007). Nothing here adds funds.
 *
 * Judge mode opens from `?judge=1` or a triple tap on the footer.
 *
 * Maps to: FR-CHK-001…015.
 */
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { getCheckoutApi, usesRealApi } from "@/lib/checkout/client";
import {
  CheckoutApiError,
  buildReceipt,
  type JudgeData,
  type Receipt as ReceiptData,
} from "@/lib/checkout/mock-api";
import type { CheckoutBalance, CheckoutSession, CheckoutView } from "@/lib/checkout/types";
import { actionGate, afterError, deriveView } from "@/lib/checkout/view";
import { formatUsd, parseRate } from "@/lib/meter/math";
import { capEndsAt, formatCap, maxEscrowNano, parseUsd } from "@/lib/checkout/funding";
import { CheckoutFrame } from "./checkout-frame";
import { FaceIdSheet, type AuthResult } from "./face-id-sheet";
import { AddMoneyStep } from "./add-money-step";
import { CapStep } from "./cap-step";
import { JudgePanel } from "./judge-panel";
import { HeldView } from "./held-view";
import { MeterView } from "./meter-view";
import { RatePanel } from "./rate-panel";
import { Receipt } from "./receipt";
import { CheckoutSkeleton, StateNotice } from "./state-notice";
import { Mail, ScanFace } from "lucide-react";
import { useAuthFlow } from "@/lib/checkout/auth-flow";

type Load =
  | { status: "loading" }
  | { status: "error"; kind: "not_found" | "error" }
  | { status: "ready"; session: CheckoutSession };

/** FR-CHK-032: how often a running meter re-reads its session from the server. */
const FOLLOW_INTERVAL_MS = 5_000;

export function CheckoutPage({ sessionId }: { sessionId: string }) {
  const api = getCheckoutApi(sessionId);
  const real = usesRealApi(sessionId);
  const flow = useAuthFlow();
  const passkeyFirst = flow.passkeyFirst;
  const params = useSearchParams();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  // FR-CHK-031: what the signed-in wallet holds, read once the cap step is reachable; null = unknown.
  const [balance, setBalance] = useState<CheckoutBalance | null>(null);
  // The escrow the subscriber is adding money for; null = the Add funds step is closed.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [judgeOpen, setJudgeOpen] = useState(params.get("judge") === "1");
  const [judge, setJudge] = useState<JudgeData | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .getSession(sessionId)
      .then((session) => alive && setLoad({ status: "ready", session }))
      .catch((e: unknown) => {
        if (!alive) return;
        setLoad({
          status: "error",
          kind: e instanceof CheckoutApiError && e.code === "not_found" ? "not_found" : "error",
        });
      });
    return () => {
      alive = false;
    };
  }, [api, sessionId, reloadKey]);

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  // FR-CHK-032: the meter follows the server. While the subscription runs or is paused, re-read
  // the session every 5 s and on focus, so a merchant cancel (FR-API-042) or a cap end on chain
  // reaches the page without a reload. The receipt then comes from the server's totals (BR-CHK-003).
  // FR-CHK-032 amendment (FR-CHK-034): a held meter follows too, so the merchant's start or a refund reaches the page.
  const following = load.status === "ready" && (load.session.subscription?.status === "active" || load.session.subscription?.status === "paused" || !!load.session.subscription?.hold);
  useEffect(() => {
    if (!following) return;
    let alive = true;
    let inFlight = false;
    const read = () => {
      if (inFlight) return;
      inFlight = true;
      api
        .getSession(sessionId)
        .then((session) => {
          if (alive) setLoad((l) => (l.status === "ready" ? { status: "ready", session } : l));
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    const id = setInterval(read, FOLLOW_INTERVAL_MS);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", read);
    };
  }, [following, api, sessionId]);

  // Re-derive the view once a second so low balance and the cap end flip
  // without a server round trip; the meter itself ticks at 100 ms inside.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!judgeOpen) return;
    api.getJudgeData(sessionId).then(setJudge).catch(() => setJudge(null));
  }, [judgeOpen, api, sessionId, now]);

  // FR-CHK-031: read the balance once the subscriber is signed in and the wallet is usable.
  const capReachable = load.status === "ready" && !!(load.session.customer || load.session.signedIn) && (!real || (flow.signedInAlready ?? false) || (load.session.signedIn ?? false));
  useEffect(() => {
    if (!capReachable || balance !== null) return;
    let alive = true;
    api
      .getBalance(sessionId)
      .then((b) => alive && setBalance(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [capReachable, balance, api, sessionId]);
  const refreshBalance = useCallback(() => api.getBalance(sessionId), [api, sessionId]);
  const onFunded = useCallback((b: CheckoutBalance) => {
    setBalance(b);
    setAddingFor(null);
    toast.success("Funds arrived");
  }, []);

  const run = useCallback(
    async (fn: () => Promise<CheckoutSession>) => {
      setBusy(true);
      try {
        const session = await fn();
        setLoad({ status: "ready", session });
      } catch (e) {
        if (e instanceof CheckoutApiError && e.code === "insufficient_funds") {
          api.getBalance(sessionId).then(setBalance).catch(() => {});
          return;
        }
        const next = afterError(e);
        toast.error(next.message);
        if (next.openSignIn) setAuthOpen(true);
      } finally {
        setBusy(false);
      }
    },
    [api, sessionId],
  );

  const onAuthenticated = useCallback(
    (r: AuthResult) => {
      setAuthOpen(false);
      void run(() => api.signIn(sessionId, r));
    },
    [api, sessionId, run],
  );

  // Back from a Google redirect: the sheet reopens on the Face ID offer, then signs in as usual.
  const resumed = flow.resumed ?? null;
  // Derived during render, the "adjust state when a prop changes" pattern: each new resume opens the sheet once.
  const [openedFor, setOpenedFor] = useState<typeof resumed>(null);
  if (resumed && resumed !== openedFor) {
    setOpenedFor(resumed);
    setAuthOpen(true);
  }

  // Privy still holds a session on this device: sign the page in silently (no sheet, no Face ID).
  const signedInAlready = flow.signedInAlready ?? false;
  const silent = useRef(false);
  useEffect(() => {
    if (!signedInAlready || resumed || silent.current) return;
    if (load.status !== "ready" || load.session.customer || load.session.signedIn) return;
    silent.current = true;
    // Reacting to Privy's session is a real effect; the sign-in is kicked off asynchronously so no state is set inside the effect itself.
    void Promise.resolve().then(() => run(() => api.signIn(sessionId, {})));
  }, [signedInAlready, resumed, load, api, sessionId, run]);

  if (load.status === "loading") {
    return (
      <CheckoutFrame merchant={{ name: " " }}>
        <CheckoutSkeleton />
      </CheckoutFrame>
    );
  }

  if (load.status === "error") {
    return (
      <CheckoutFrame merchant={{ name: "Elapse" }}>
        <StateNotice kind={load.kind} onRetry={retry} />
      </CheckoutFrame>
    );
  }

  const { session } = load;
  const view: CheckoutView = deriveView(session, now);
  // FR-CHK-002: on the real API the cap and start steps sign with the device's wallet, which Privy restores after load.
  const gate = actionGate({ ready: flow.ready ?? true, walletReady: real ? (flow.signedInAlready ?? false) || (session.signedIn ?? false) : true, needsWallet: view === "cap" || view === "ready" });
  const successHref = `${session.merchant.successUrl}${session.merchant.successUrl.includes("?") ? "&" : "?"}session_id=${session.id}`;

  // A session that has stopped still gets a receipt when opened later,
  // rebuilt from the subscription (BR-CHK-003). A meter that ran past its
  // cap is treated as ended at that second even before the API agrees
  // (FR-CHK-007).
  const stopped = ((): { sub: NonNullable<CheckoutSession["subscription"]> } | null => {
    const sb = session.subscription;
    if (!sb) return null;
    // Checked before startedAt: a held meter stopped before the merchant started it still gets its receipt (FR-CHK-034).
    if (sb.status === "canceled" && sb.canceledAt !== null) return { sub: sb };
    if (sb.startedAt === null) return null;
    if (view !== "canceled") return null;
    const endsAt = capEndsAt(sb.startedAt, parseUsd(sb.fundedUsd), parseRate(sb.rateUsdPerSecond));
    if (endsAt === null) return null;
    return {
      sub: { ...sb, status: "canceled", endedReason: "cap_reached", pausedAt: endsAt, canceledAt: endsAt },
    };
  })();
  const shownReceipt: ReceiptData | null = receipt ?? (stopped ? buildReceipt(stopped.sub) : null);

  // Stop from the meter (FR-CHK-008) or from the held view (FR-CHK-034): one path, the receipt comes back with the session.
  const stop = async () => {
    setBusy(true);
    try {
      const r = await api.cancel(sessionId);
      setReceipt(r.receipt);
      setLoad({ status: "ready", session: r.session });
    } catch (e) {
      const next = afterError(e);
      toast.error(next.message);
      if (next.openSignIn) setAuthOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const startAgain = async () => {
    setBusy(true);
    try {
      const next = await api.startAgain(sessionId);
      router.push(`/c/${next.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open a new session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CheckoutFrame merchant={session.merchant} onJudgeGesture={() => setJudgeOpen(true)}>
      <Toaster position="top-center" />

      {view === "expired" && <StateNotice kind="expired" merchant={session.merchant} />}
      {view === "used" && <StateNotice kind="used" merchant={session.merchant} />}
      {view === "archived" && <StateNotice kind="archived" merchant={session.merchant} />}

      {view === "signin" && (
        <div className="flex flex-1 flex-col gap-4">
          <RatePanel product={session.product} />
          <div className="mt-auto flex flex-col gap-2 pt-2">
            {(flow.ready ?? true) ? (
              <Button size="lg" onClick={() => setAuthOpen(true)} className="h-12 w-full text-base">
                {passkeyFirst ? <ScanFace data-icon="inline-start" className="size-5" /> : <Mail data-icon="inline-start" className="size-5" />}
                {passkeyFirst ? "Continue with Face ID" : "Continue with email"}
              </Button>
            ) : (
              <Button size="lg" disabled className="h-12 w-full text-base">
                Checking your sign-in…
              </Button>
            )}
            <a
              href={session.merchant.cancelUrl}
              className="flex min-h-11 items-center justify-center text-center text-sm !text-ink-soft !no-underline hover:!text-foreground"
            >
              Not now
            </a>
          </div>
          <FaceIdSheet
            open={authOpen}
            onOpenChange={setAuthOpen}
            merchantName={session.merchant.name}
            onAuthenticated={onAuthenticated}
            resume={resumed}
          />
        </div>
      )}

      {(view === "cap" || view === "ready") && gate !== "ok" && (
        <div className="flex flex-1 flex-col gap-4">
          <RatePanel product={session.product} />
          <div className="mt-auto flex flex-col gap-2 pt-2">
            {gate === "pending" ? (
              <Button size="lg" disabled className="h-12 w-full text-base">
                Checking your sign-in…
              </Button>
            ) : (
              <Button size="lg" onClick={() => setAuthOpen(true)} className="h-12 w-full text-base">
                {passkeyFirst ? <ScanFace data-icon="inline-start" className="size-5" /> : <Mail data-icon="inline-start" className="size-5" />}
                {passkeyFirst ? "Continue with Face ID" : "Continue with email"}
              </Button>
            )}
          </div>
        </div>
      )}

      {(view === "cap" || view === "ready") && gate === "ok" && addingFor !== null && balance && (
        <AddMoneyStep neededUsd={addingFor} initial={balance} refresh={refreshBalance} onFunded={onFunded} cancelHref={session.merchant.cancelUrl} />
      )}

      {view === "cap" && gate === "ok" && addingFor === null && (
        <div className="flex flex-1 flex-col gap-5">
          <RatePanel product={session.product} />
          <CapStep
            rateUsdPerSecond={session.product.rateUsdPerSecond}
            availableUsd={balance?.needsFunding ? balance.balanceUsd : undefined}
            initialSeconds={session.lastMaxDurationSeconds}
            busy={busy}
            onChoose={(seconds) => run(() => api.setCap(sessionId, seconds))}
            onAddMoney={(seconds) => setAddingFor(formatUsd(maxEscrowNano(seconds, parseRate(session.product.rateUsdPerSecond)), 3, { symbol: false }))}
          />
        </div>
      )}

      {view === "ready" && gate === "ok" && session.subscription && addingFor === null && balance?.needsFunding && parseUsd(balance.balanceUsd) < parseUsd(session.subscription.fundedUsd) && (
        <AddMoneyStep neededUsd={session.subscription.fundedUsd} initial={balance} refresh={refreshBalance} onFunded={onFunded} cancelHref={session.merchant.cancelUrl} />
      )}

      {view === "ready" && gate === "ok" && session.subscription && addingFor === null && !(balance?.needsFunding && parseUsd(balance.balanceUsd) < parseUsd(session.subscription.fundedUsd)) && (
        <div className="flex flex-1 flex-col gap-4">
          <RatePanel product={session.product} />
          <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-ink-soft">
                Up to {formatCap(session.subscription.maxDurationSeconds)}
              </span>
              <span className="numerals text-lg">
                {formatUsd(parseUsd(session.subscription.fundedUsd))}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              The most this session can cost. You pay only the seconds you use.
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => run(() => api.start(sessionId))}
              className="h-12 w-full text-base"
            >
              {busy ? "Starting…" : "Start"}
            </Button>
            <p className="text-center text-xs text-ink-soft">
              The meter starts the moment you press Start.
            </p>
          </div>
        </div>
      )}

      {view === "held" && session.subscription?.hold && (
        <HeldView
          productName={session.product.name}
          merchantName={session.merchant.name}
          successHref={successHref}
          hold={session.subscription.hold}
          busy={busy}
          onStop={stop}
        />
      )}

      {(view === "running" || view === "low_balance" || view === "paused") &&
        session.subscription && (
          <MeterView
            product={session.product}
            subscription={session.subscription}
            view={view}
            busy={busy}
            merchantName={session.merchant.name}
            successHref={successHref}
            onCancel={stop}
            onPause={() => run(() => api.pause(sessionId))}
            onResume={() => run(() => api.resume(sessionId))}
          />
        )}

      {view === "canceled" && shownReceipt && (
        <Receipt
          receipt={shownReceipt}
          product={session.product}
          merchant={session.merchant}
          successHref={successHref}
          maxDurationSeconds={session.subscription?.maxDurationSeconds}
          onStartAgain={startAgain}
          restartedAs={session.restartedAs}
          startBusy={busy}
          emailBusy={emailBusy}
          emailSentTo={emailSentTo}
          onEmail={
            // FR-CHK-029: offered only when the sign-in carries an email to send to.
            session.customer?.email
              ? async () => {
                  setEmailBusy(true);
                  try {
                    await api.emailReceipt(sessionId, session.customer?.email ?? "");
                    setEmailSentTo(session.customer?.email ?? null);
                    window.setTimeout(() => setEmailSentTo(null), 10_000);
                  } catch (e) {
                    toast.error(e instanceof CheckoutApiError && e.code === "already_sent" ? "Already sent. Check your inbox." : "We couldn't send the receipt. Try again.");
                  } finally {
                    setEmailBusy(false);
                  }
                }
              : undefined
          }
        />
      )}

      <JudgePanel open={judgeOpen} onOpenChange={setJudgeOpen} data={judge} />
    </CheckoutFrame>
  );
}
