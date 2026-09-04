/**
 * `SubscriptionDetail` — right pane: the meter at panel size, its rate,
 * funded / settled / runtime left, customer and session links, the
 * lifecycle timeline, the settlements, and Cancel (with a confirmation
 * that states the live figures).
 *
 * Maps to: FR-DSH-041, FR-DSH-042, FR-DSH-043, FR-DSH-044; BR-DSH-005, BR-DSH-008.
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/site/copy-button";
import { txUrl } from "@/lib/dashboard/chain";
import { shortHex, when } from "@/lib/dashboard/format";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import type { Subscription } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { formatRuntimeShort, remainingRuntimeMs } from "@/lib/checkout/funding";
import { formatUsd, parseRate, perHour, settledNano, wholeSeconds } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";
import { LiveAmount } from "./live-amount";
import { useMerchant } from "./merchant-context";
import { StatusChip } from "./status-chip";
import { SUB_TONE, subWord } from "./subscriptions-list";

export function SubscriptionDetail({ subscriptionId }: { subscriptionId: string }) {
  const { api } = useMerchant();
  const fetcher = useCallback(() => api.getSubscription(subscriptionId), [api, subscriptionId]);
  const { data, loading, error, reload } = usePoll(fetcher);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { receipt } = await api.cancelSubscription(subscriptionId, { idempotencyKey: newIdempotencyKey() });
      setConfirm(false);
      toast.success(`Stopped. ${receipt.secondsElapsed} seconds · $${receipt.amountSettledUsd} charged, $${receipt.refundedUsd} returned.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (error instanceof DashboardApiError && error.code === "not_found") {
    return (
      <div className="px-5 py-6 md:px-8">
        <p className="text-[15px]">We can&apos;t find this subscription.</p>
        <p className="mt-1 text-[13px] text-ink-soft">It may belong to the other mode. Switch Test / Live and try again.</p>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="px-5 py-6 md:px-8" aria-busy>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const { subscription: s, timeline, invoices } = data;
  const rate = parseRate(s.rateUsdPerSecond);
  const funded = parseRate(s.fundedUsd.replace(/,/g, ""));
  const running = s.status === "active";

  return (
    <div className="px-5 py-6 md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[1.125rem] font-semibold tracking-[-0.01em]">{s.product.name}</h2>
        <StatusChip tone={SUB_TONE[s.status]}>{subWord(s.status)}</StatusChip>
        {s.endedReason === "cap_reached" && (
          <span className="text-[12px] text-caution">Reached its limit</span>
        )}
      </div>
      <p className="numerals mt-1 flex items-center gap-1 text-[12px] text-ink-soft">
        {s.id}
        <CopyButton text={s.id} label="Copy subscription id" className="size-7" />
      </p>

      <section className="mt-5 rounded-lg border border-border bg-card px-5 py-5">
        {s.status === "incomplete" ? (
          <p className="text-[14px] text-ink-soft">Checkout opened, meter not started.</p>
        ) : (
          <LiveAmount subscription={s} size="panel" />
        )}
        <p className="numerals mt-4 text-[13px] text-ink-soft">
          ${s.rateUsdPerSecond} / second · {formatUsd(perHour(rate), 2)} / hour
        </p>
      </section>

      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-[repeat(3,minmax(0,1fr))] sm:divide-y-0">
        <div className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
          <dt className="placard">Funded</dt>
          <dd className="numerals text-[15px]">${s.fundedUsd}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
          <dt className="placard">Settled</dt>
          <dd className="numerals text-[15px]">${s.settledUsd}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
          <dt className="placard">Runtime left</dt>
          <dd className="numerals text-[15px]">
            {running ? <RuntimeLeft s={s} rate={rate} funded={funded} /> : "—"}
          </dd>
        </div>
      </dl>

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[13px]">
        <dt className="text-ink-soft">Customer</dt>
        <dd className="numerals truncate">
          <Link href={`/dashboard/customers/${s.customer.id}`} className="underline-offset-4 hover:underline">
            {s.customer.email ?? s.customer.id}
          </Link>
        </dd>
        <dt className="text-ink-soft">Checkout session</dt>
        <dd className="numerals truncate">{s.checkoutSession}</dd>
        <dt className="text-ink-soft">Started</dt>
        <dd className="numerals">{s.startedAt ? when(s.startedAt) : "—"}</dd>
        {s.canceledAt && (
          <>
            <dt className="text-ink-soft">Stopped</dt>
            <dd className="numerals">{when(s.canceledAt)}</dd>
          </>
        )}
      </dl>

      {running && (
        <Button variant="destructive" onClick={() => setConfirm(true)} className="mt-5 h-9">
          Cancel meter
        </Button>
      )}

      <section className="mt-8">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Timeline</h3>
        <ol aria-label="Timeline" className="mt-3 divide-y divide-border rounded-lg border border-border">
          {timeline.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-soft">Nothing yet.</li>}
          {timeline.map((e) => (
            <li key={e.id}>
              <Link href={`/dashboard/developers/events/${e.id}`} className="flex min-h-11 flex-col gap-0.5 px-4 py-2 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3">
                <span className="numerals min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">{e.type}</span>
                <span className="numerals shrink-0 text-[12px] text-ink-soft">{when(e.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Settlements</h3>
        {invoices.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border px-4 py-6 text-center text-[13px] text-ink-soft">Nothing settled yet. The keeper pulls every few minutes and on cancel.</p>
        ) : (
          <ol aria-label="Settlements" className="mt-3 divide-y divide-border rounded-lg border border-border">
            {invoices.map((inv) => (
              <li key={inv.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_auto] sm:items-center">
                <span className="numerals flex flex-wrap gap-x-2 text-ink-soft">
                  <span className="whitespace-nowrap">{when(inv.settledAt)}</span>
                  <span className="whitespace-nowrap">{inv.seconds} s</span>
                </span>
                <span className="numerals sm:text-right">
                  <span className="placard mr-1 sm:hidden">Gross</span>${inv.grossUsd}
                </span>
                <span className="numerals text-ink-soft sm:text-right">
                  <span className="placard mr-1 sm:hidden">Fee</span>−${inv.feeUsd}
                </span>
                <span className="numerals sm:text-right">
                  <span className="placard mr-1 sm:hidden">Net</span>${inv.netUsd}
                </span>
                <a
                  href={txUrl(inv.txId, inv.livemode)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View on explorer: ${inv.txId}`}
                  className="numerals inline-flex items-center gap-1 text-[12px] text-ink-soft hover:text-foreground"
                >
                  {shortHex(inv.txId)}
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <CancelDialog open={confirm} s={s} busy={busy} onCancel={() => setConfirm(false)} onConfirm={cancel} />
    </div>
  );
}

function RuntimeLeft({ s, rate, funded }: { s: Subscription; rate: bigint; funded: bigint }) {
  const meter = useMeter({ rate: s.rateUsdPerSecond, startedAt: s.startedAt, pausedAt: s.pausedAt, tickMs: 1000 });
  return <>{formatRuntimeShort(remainingRuntimeMs(funded, rate, meter.elapsedMs))}</>;
}

function CancelDialog({ open, s, busy, onCancel, onConfirm }: { open: boolean; s: Subscription; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const rate = parseRate(s.rateUsdPerSecond);
  const meter = useMeter({ rate: s.rateUsdPerSecond, startedAt: s.startedAt, pausedAt: s.pausedAt, tickMs: 1000 });
  const secs = wholeSeconds(meter.elapsedMs);
  const charged = settledNano(rate, secs);
  const funded = parseRate(s.fundedUsd.replace(/,/g, ""));
  const capped = charged > funded ? funded : charged;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop this meter?</DialogTitle>
          <DialogDescription>
            The meter stops now. The subscriber is charged{" "}
            <span className="numerals text-[13px] text-foreground">
              {secs} {secs === 1 ? "second" : "seconds"} so far · {formatUsd(capped, 3)}
            </span>{" "}
            and refunded the rest, <span className="numerals text-[13px] text-foreground">{formatUsd(funded - capped, 3)}</span>. Your server receives subscription.canceled.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="h-9">
            Keep running
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy} className="h-9">
            {busy ? "Stopping…" : "Stop the meter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
