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
 * Maps to: FR-CHK-016–026; BR-CHK-001, BR-CHK-007.
 */
"use client";

import { ScanFace } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { FaceIdSheet } from "@/components/checkout/face-id-sheet";
import type { AccountApi } from "@/lib/account/mock-api";
import type { AccountMeter, AccountReceipt, AccountView } from "@/lib/account/types";
import { AccountFrame } from "./account-frame";
import { CancelSheet } from "./cancel-sheet";
import { MeterRow } from "./meter-row";
import { ReceiptRow, ReceiptSheet } from "./receipt-list";
import { RunningTotal } from "./running-total";

/** Receipts shown before "Show more"; a subscriber wants the recent ones. */
const RECEIPTS_SHOWN = 3;

export function AccountPage({ api }: { api: AccountApi }) {
  const [view, setView] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [stopping, setStopping] = useState<AccountMeter | null>(null);
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
    }, 1000);
    return () => clearInterval(id);
  }, [api]);

  const onAuthenticated = useCallback(() => {
    setAuthOpen(false);
    setBusy(true);
    api
      .signIn()
      .then(setView)
      .catch(() => toast.error("Could not sign you in"))
      .finally(() => setBusy(false));
  }, [api]);

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

  const { meters, receipts } = view;
  const nothing = meters.length === 0 && receipts.length === 0;

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
          <RunningTotal meters={meters} />

          {meters.length > 0 && (
            <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {meters.map((m) => (
                <MeterRow
                  key={m.subscription}
                  meter={m}
                  busy={busy}
                  onStop={() => setStopping(m)}
                />
              ))}
            </section>
          )}

          {receipts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="placard">Past sessions</h2>
              {receipts.slice(0, receiptLimit).map((r) => (
                <ReceiptRow key={r.invoice} receipt={r} onOpen={() => setOpenReceipt(r)} />
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
        emailBusy={busy}
        onEmail={async () => {
          if (!openReceipt) return;
          setBusy(true);
          try {
            await api.emailReceipt(openReceipt.invoice);
            toast.success("Receipt sent");
          } catch {
            toast.error("Could not send the receipt");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AccountFrame>
  );
}
