/**
 * `AccountPage` — the subscriber's own page: every meter they have
 * running, across every merchant, and every receipt.
 *
 * Elapse-branded on purpose: it spans merchants, so it cannot wear one
 * merchant's colours (ADR 2026-09-04). It is optional for merchants —
 * everything here is also available to them through the SDK — and a
 * subscriber finds it from their own receipt (FR-CHK-017).
 *
 * No judge mode: that panel lives on the checkout alone (FR-CHK-026).
 *
 * Maps to: FR-CHK-016–026, FR-CHK-030; BR-CHK-001, BR-CHK-007.
 */
"use client";

import { ScanFace } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { FaceIdSheet } from "@/components/checkout/face-id-sheet";
import type { AccountApi } from "@/lib/account/mock-api";
import type { AccountHeld, AccountMeter, AccountReceipt, AccountView } from "@/lib/account/types";
import { AccountFrame } from "./account-frame";
import { CancelSheet } from "./cancel-sheet";
import { HeldRow } from "./held-row";
import { MeterRow } from "./meter-row";
import { ReceiptRow, ReceiptSheet } from "./receipt-list";
import { RunningTotal } from "./running-total";

/** Receipts shown before "Show more"; a subscriber wants the recent ones. */
const RECEIPTS_SHOWN = 3;

export function AccountPage({
  api,
  pollMs = 1000,
  email,
}: {
  api: AccountApi;
  /** How often the view is re-read: 1 s against the mock, 5 s against the API (FR-CHK-018). */
  pollMs?: number;
  /** The sign-in's email, for the receipt's "Sent to …"; absent = no Email receipt button (FR-CHK-029). */
  email?: string | null;
}) {
  const [view, setView] = useState<AccountView | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [stopping, setStopping] = useState<AccountMeter | AccountHeld | null>(null);
  const [pending, setPending] = useState<{ subscription: string; action: "pause" | "resume" } | null>(null);
  const [openReceipt, setOpenReceipt] = useState<AccountReceipt | null>(null);
  const [receiptLimit, setReceiptLimit] = useState(RECEIPTS_SHOWN);

  useEffect(() => {
    let alive = true;
    api
      .getView()
      .then((v) => alive && setView(v))
      .catch(() => alive && toast.error("Could not load your meters"));
    return () => {
      alive = false;
    };
  }, [api]);

  // A meter that reaches its cap ends by itself (FR-CHK-007). Re-reading
  // once a second lets the row become a receipt without a page refresh.
  useEffect(() => {
    const id = setInterval(() => {
      api.getView().then(setView).catch(() => {});
    }, pollMs);
    return () => clearInterval(id);
  }, [api, pollMs]);

  const onAuthenticated = useCallback(() => {
    setAuthOpen(false);
    setBusy(true);
    api
      .signIn()
      .then(setView)
      .catch(() => toast.error("Could not sign you in"))
      .finally(() => setBusy(false));
  }, [api]);

  // FR-CHK-030: one tap, no sheet — nothing is charged or refunded and it reverses.
  const toggle = useCallback(
    async (m: AccountMeter, action: "pause" | "resume") => {
      setBusy(true);
      setPending({ subscription: m.subscription, action });
      try {
        setView(await (action === "pause" ? api.pause(m.subscription) : api.resume(m.subscription)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not ${action} the meter`);
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [api],
  );

  const confirmStop = useCallback(async () => {
    if (!stopping) return;
    setBusy(true);
    try {
      const { view: next } = await api.cancel(stopping.subscription);
      setView(next);
      setStopping(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop the meter");
    } finally {
      setBusy(false);
    }
  }, [api, stopping]);

  if (!view) {
    return (
      <AccountFrame>
        <div className="flex flex-1 flex-col gap-3" aria-busy aria-label="Loading your meters">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      </AccountFrame>
    );
  }

  if (view.status === "signed_out") {
    return (
      <AccountFrame>
        <Toaster position="top-center" />
        <section className="flex flex-1 flex-col justify-center gap-6 py-10">
          <div>
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">
              Your meters, in one place.
            </h1>
            <p className="mt-3 max-w-[38ch] text-pretty text-ink-soft">
              Sign in the same way you started them, and see everything you are paying by the
              second.
            </p>
          </div>
          <Button size="lg" onClick={() => setAuthOpen(true)} className="h-12 w-full text-base">
            <ScanFace data-icon="inline-start" className="size-5" />
            Continue with Face ID
          </Button>
        </section>
        <FaceIdSheet
          open={authOpen}
          onOpenChange={setAuthOpen}
          merchantName="Elapse"
          onAuthenticated={onAuthenticated}
        />
      </AccountFrame>
    );
  }

  const { held, meters, receipts } = view;
  const nothing = held.length === 0 && meters.length === 0 && receipts.length === 0;

  return (
    <AccountFrame>
      <Toaster position="top-center" />

      {nothing ? (
        <section className="flex flex-1 flex-col justify-center gap-3 py-10">
          <h1 className="text-balance text-xl font-semibold leading-tight tracking-[-0.02em]">
            No meters yet.
          </h1>
          <p className="max-w-[38ch] text-pretty text-ink-soft">
            When a merchant sends you a link, your meters show up here.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {/* FR-CHK-036: held money sits above running meters and never counts toward the running total. */}
          {held.length > 0 && (
            <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {held.map((h) => (
                <HeldRow key={h.subscription} held={h} />
              ))}
            </section>
          )}

          <RunningTotal meters={meters} />

          {meters.length > 0 && (
            <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {meters.map((m) => (
                <MeterRow
                  key={m.subscription}
                  meter={m}
                  busy={busy}
                  pending={pending?.subscription === m.subscription ? pending.action : null}
                  onStop={() => setStopping(m)}
                  onPause={() => toggle(m, "pause")}
                  onResume={() => toggle(m, "resume")}
                />
              ))}
            </section>
          )}

          {receipts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="placard">Past sessions</h2>
              {receipts.slice(0, receiptLimit).map((r) => (
                <ReceiptRow key={r.subscription} receipt={r} onOpen={() => setOpenReceipt(r)} />
              ))}
              {receipts.length > receiptLimit && (
                <button
                  type="button"
                  onClick={() => setReceiptLimit((n) => n + RECEIPTS_SHOWN)}
                  className="min-h-11 rounded-lg border border-border px-4 text-sm text-ink-soft transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Show {Math.min(RECEIPTS_SHOWN, receipts.length - receiptLimit)} more
                </button>
              )}
            </section>
          )}
        </div>
      )}

      <CancelSheet
        meter={stopping}
        open={stopping !== null}
        busy={busy}
        onOpenChange={(o) => !o && setStopping(null)}
        onConfirm={confirmStop}
      />

      <ReceiptSheet
        receipt={openReceipt}
        open={openReceipt !== null}
        onOpenChange={(o) => !o && setOpenReceipt(null)}
        emailBusy={emailBusy}
        emailSentTo={emailSentTo}
        onEmail={
          email === null
            ? undefined
            : async () => {
                if (!openReceipt) return;
                setEmailBusy(true);
                try {
                  await api.emailReceipt(openReceipt.subscription);
                  setEmailSentTo(email ?? "your email");
                  window.setTimeout(() => setEmailSentTo(null), 10_000);
                } catch (e) {
                  toast.error((e as { code?: string }).code === "already_sent" ? "Already sent. Check your inbox." : "Could not send the receipt");
                } finally {
                  setEmailBusy(false);
                }
              }
        }
      />
    </AccountFrame>
  );
}
