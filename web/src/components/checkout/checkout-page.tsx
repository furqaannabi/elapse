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
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { getCheckoutApi } from "@/lib/checkout/client";
import {
  CheckoutApiError,
  buildReceipt,
  type JudgeData,
  type Receipt as ReceiptData,
} from "@/lib/checkout/mock-api";
import type { CheckoutSession, CheckoutView } from "@/lib/checkout/types";
import { deriveView } from "@/lib/checkout/view";
import { formatUsd, parseRate } from "@/lib/meter/math";
import { capEndsAt, formatCap, parseUsd } from "@/lib/checkout/funding";
import { CheckoutFrame } from "./checkout-frame";
import { FaceIdSheet, type AuthResult } from "./face-id-sheet";
import { CapStep } from "./cap-step";
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
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
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

  // A session that has stopped still gets a receipt when opened later,
  // rebuilt from the subscription (BR-CHK-003). A meter that ran past its
  // cap is treated as ended at that second even before the API agrees
  // (FR-CHK-007).
  const stopped = ((): { sub: NonNullable<CheckoutSession["subscription"]> } | null => {
    const sb = session.subscription;
    if (!sb || sb.startedAt === null) return null;
    if (sb.status === "canceled" && sb.canceledAt !== null) return { sub: sb };
    if (view !== "canceled") return null;
    const endsAt = capEndsAt(sb.startedAt, parseUsd(sb.fundedUsd), parseRate(sb.rateUsdPerSecond));
    if (endsAt === null) return null;
    return {
      sub: { ...sb, status: "canceled", endedReason: "cap_reached", pausedAt: endsAt, canceledAt: endsAt },
    };
  })();
  const shownReceipt: ReceiptData | null = receipt ?? (stopped ? buildReceipt(stopped.sub) : null);

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

      {view === "cap" && (
        <div className="flex flex-1 flex-col gap-5">
          <RatePanel product={session.product} />
          <CapStep
            rateUsdPerSecond={session.product.rateUsdPerSecond}
            busy={busy}
            onChoose={(seconds) => run(() => api.setCap(sessionId, seconds))}
          />
        </div>
      )}

      {view === "ready" && session.subscription && (
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

      {(view === "running" || view === "low_balance" || view === "paused") &&
        session.subscription && (
          <MeterView
            product={session.product}
            subscription={session.subscription}
            view={view}
            busy={busy}
            merchantName={session.merchant.name}
            successHref={successHref}
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
          startBusy={busy}
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

      <JudgePanel open={judgeOpen} onOpenChange={setJudgeOpen} data={judge} />
    </CheckoutFrame>
  );
}
