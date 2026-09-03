/**
 * `CheckoutPage` — the client orchestrator for `/c/[session]`.
 *
 * Loads the session, re-derives the view every tick, and hands each view
 * to its screen. All money and state rules live in `lib/checkout`; this
 * file only wires actions to the API and decides which sheet is open.
 *
 * Judge mode opens from `?judge=1` or a triple tap on the footer.
 *
 * Maps to: FR-CHK-001…015.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getCheckoutApi } from "@/lib/checkout/client";
import { CheckoutApiError, type JudgeData, type Receipt as ReceiptData } from "@/lib/checkout/mock-api";
import type { CheckoutSession, CheckoutView } from "@/lib/checkout/types";
import { deriveView } from "@/lib/checkout/view";
import { formatUsd, parseRate, settledNano, wholeSeconds, elapsedMs } from "@/lib/meter/math";
import { formatReceiptUsd, parseUsd, refundNano } from "@/lib/checkout/funding";
import { CheckoutFrame } from "./checkout-frame";
import { FaceIdSheet, type AuthResult } from "./face-id-sheet";
import { FundStep } from "./fund-step";
import { JudgePanel } from "./judge-panel";
import { MeterView } from "./meter-view";
import { RatePanel } from "./rate-panel";
import { Receipt } from "./receipt";
import { CheckoutSkeleton, StateNotice } from "./state-notice";
import { ScanFace } from "lucide-react";

type Load =
  | { status: "loading" }
  | { status: "error"; kind: "not_found" | "error" }
  | { status: "ready"; session: CheckoutSession };

export function CheckoutPage({ sessionId }: { sessionId: string }) {
  const api = getCheckoutApi();
  const params = useSearchParams();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
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

  // Re-derive the view once a second so low-balance / out-of-funds flip
  // without a server round trip; the meter itself ticks at 100 ms inside.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!judgeOpen) return;
    api.getJudgeData(sessionId).then(setJudge).catch(() => setJudge(null));
  }, [judgeOpen, api, sessionId, now]);

  const run = useCallback(
    async (fn: () => Promise<CheckoutSession>) => {
      setBusy(true);
      try {
        const session = await fn();
        setLoad({ status: "ready", session });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onAuthenticated = useCallback(
    (r: AuthResult) => {
      setAuthOpen(false);
      void run(() => api.signIn(sessionId, r));
    },
    [api, sessionId, run],
  );

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
  const successHref = `${session.merchant.successUrl}${session.merchant.successUrl.includes("?") ? "&" : "?"}session_id=${session.id}`;

  // A canceled session opened later still gets a receipt, reconstructed
  // from the subscription (BR-CHK-003).
  const shownReceipt: ReceiptData | null =
    receipt ??
    (view === "canceled" && session.subscription?.startedAt && session.subscription.canceledAt
      ? (() => {
          const sb = session.subscription;
          const secs = wholeSeconds(
            elapsedMs({ startedAt: sb.startedAt!, now: sb.canceledAt!, pausedAt: sb.pausedAt }),
          );
          const rate = parseRate(sb.rateUsdPerSecond);
          const funded = parseUsd(sb.fundedUsd);
          const settled = settledNano(rate, secs) > funded ? funded : settledNano(rate, secs);
          return {
            secondsElapsed: secs,
            amountSettledUsd: formatReceiptUsd(settled),
            refundedUsd: formatReceiptUsd(refundNano(funded, settled)),
            startedAt: sb.startedAt!,
            canceledAt: sb.canceledAt!,
            rateUsdPerSecond: sb.rateUsdPerSecond,
          };
        })()
      : null);

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
            <Button size="lg" onClick={() => setAuthOpen(true)} className="h-12 w-full text-base">
              <ScanFace data-icon="inline-start" className="size-5" />
              Continue with Face ID
            </Button>
            <a
              href={session.merchant.cancelUrl}
              className="py-2 text-center text-sm !text-ink-soft !no-underline hover:!text-foreground"
            >
              Not now
            </a>
          </div>
          <FaceIdSheet
            open={authOpen}
            onOpenChange={setAuthOpen}
            merchantName={session.merchant.name}
            onAuthenticated={onAuthenticated}
          />
        </div>
      )}

      {view === "fund" && (
        <div className="flex flex-1 flex-col gap-5">
          <RatePanel product={session.product} />
          <FundStep
            rateUsdPerSecond={session.product.rateUsdPerSecond}
            busy={busy}
            onFund={(usd) => run(() => api.fund(sessionId, usd))}
          />
        </div>
      )}

      {view === "ready" && session.subscription && (
        <div className="flex flex-1 flex-col gap-4">
          <RatePanel product={session.product} />
          <div className="rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-ink-soft">Loaded</span>
              <span className="numerals text-lg">
                {formatUsd(parseUsd(session.subscription.fundedUsd))}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTopupOpen(true)}
              className="mt-1 text-xs text-ink-soft underline underline-offset-3 hover:text-foreground"
            >
              Add more
            </button>
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

      {(view === "running" || view === "low_balance" || view === "out_of_funds" || view === "paused") &&
        session.subscription && (
          <MeterView
            product={session.product}
            subscription={session.subscription}
            view={view}
            busy={busy}
            onCancel={async () => {
              setBusy(true);
              try {
                const r = await api.cancel(sessionId);
                setReceipt(r.receipt);
                setLoad({ status: "ready", session: r.session });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not stop the meter");
              } finally {
                setBusy(false);
              }
            }}
            onPause={() => run(() => api.pause(sessionId))}
            onResume={() => run(() => api.resume(sessionId))}
            onAddFunds={() => setTopupOpen(true)}
          />
        )}

      {view === "canceled" && shownReceipt && (
        <Receipt
          receipt={shownReceipt}
          product={session.product}
          merchant={session.merchant}
          successHref={successHref}
          emailBusy={busy}
          onEmail={async () => {
            setBusy(true);
            try {
              await api.emailReceipt(sessionId, session.customer?.email ?? "");
              toast.success("Receipt sent");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      <Sheet open={topupOpen} onOpenChange={setTopupOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-[480px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="px-0 pt-4">
            <SheetTitle className="text-base">Add funds</SheetTitle>
          </SheetHeader>
          <FundStep
            mode="topup"
            rateUsdPerSecond={session.product.rateUsdPerSecond}
            busy={busy}
            onFund={async (usd) => {
              await run(() => api.fund(sessionId, usd));
              setTopupOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <JudgePanel open={judgeOpen} onOpenChange={setJudgeOpen} data={judge} />
    </CheckoutFrame>
  );
}
