/**
 * `MeterView` — the running meter on a phone: the readout, what it costs,
 * how long the funds last, and one Cancel. Pause appears only when the
 * product allows it. Low-balance and out-of-funds are amber notices inside
 * the same panel, not new screens, so the counter never disappears.
 *
 * Maps to: FR-CHK-005, FR-CHK-006, FR-CHK-007; BR-CHK-004.
 */
"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartStrip, type Session } from "@/components/meter/chart-strip";
import { Readout } from "@/components/meter/readout";
import { formatRuntime, remainingRuntimeMs, parseUsd } from "@/lib/checkout/funding";
import type { CheckoutView, Product, Subscription } from "@/lib/checkout/types";
import { formatUsd, perHour } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";
import { cn } from "@/lib/utils";

export function MeterView({
  product,
  subscription,
  view,
  busy,
  onCancel,
  onPause,
  onResume,
  onAddFunds,
}: {
  product: Product;
  subscription: Subscription;
  view: Extract<CheckoutView, "running" | "low_balance" | "out_of_funds" | "paused">;
  busy?: boolean;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onAddFunds: () => void;
}) {
  const meter = useMeter({
    rate: subscription.rateUsdPerSecond,
    startedAt: subscription.startedAt,
    pausedAt: subscription.pausedAt,
  });
  const funded = parseUsd(subscription.fundedUsd);
  const remaining = remainingRuntimeMs(funded, meter.rateNano, meter.elapsedMs);
  const sessions: Session[] = subscription.startedAt
    ? [{ start: subscription.startedAt, end: subscription.pausedAt }]
    : [];
  const started = subscription.startedAt
    ? new Date(subscription.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const outOfFunds = view === "out_of_funds";
  const paused = view === "paused" || outOfFunds;

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="placard truncate">{product.name}</span>
          <span className="numerals shrink-0 text-xs text-ink-soft">
            ${product.rateUsdPerSecond}/s
          </span>
        </div>

        <div className="flex flex-col gap-4 px-5 pt-6 pb-5">
          <Readout
            elapsed={meter.elapsed}
            accrued={meter.accruedLive}
            running={meter.running}
            size="panel"
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-soft">Status</dt>
            <dd className="text-right">
              {outOfFunds ? "Paused · out of funds" : paused ? "Paused" : "Running"}
            </dd>
            {started && (
              <>
                <dt className="text-ink-soft">Started</dt>
                <dd className="numerals text-right">{started}</dd>
              </>
            )}
            <dt className="text-ink-soft">Funds left</dt>
            <dd className="numerals whitespace-nowrap text-right">
              {formatUsd(funded - meter.accruedNano > 0n ? funded - meter.accruedNano : 0n)}
              <span className="text-ink-soft"> · {formatRuntime(remaining).replace("≈ ", "")}</span>
            </dd>
            <dt className="text-ink-soft">At this rate</dt>
            <dd className="numerals text-right">{formatUsd(perHour(meter.rateNano))} / hour</dd>
          </dl>
        </div>

        <div className="border-t border-border bg-paper/40">
          <ChartStrip sessions={sessions} height={96} level={0.55} pxPerSecond={24} />
        </div>
      </div>

      {(view === "low_balance" || outOfFunds) && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm",
            outOfFunds ? "bg-live text-[#0a0a0a]" : "border border-live/40 bg-live-soft",
          )}
        >
          <span className="font-medium">
            {outOfFunds
              ? "Out of funds. The meter is paused."
              : `About ${formatRuntime(remaining).replace("≈ ", "")} of funds left.`}
          </span>
          {!outOfFunds && (
            <Button size="sm" variant="outline" onClick={onAddFunds} className="h-9 shrink-0">
              Add funds
            </Button>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {view === "paused" && (
          <Button size="lg" onClick={onResume} disabled={busy} className="h-12 w-full text-base">
            <Play data-icon="inline-start" className="size-4" />
            Resume
          </Button>
        )}
        {outOfFunds && (
          <Button size="lg" onClick={onAddFunds} disabled={busy} className="h-12 w-full text-base">
            Add funds to resume
          </Button>
        )}
        <div className="flex gap-2">
          {product.allowPause && view !== "paused" && !outOfFunds && (
            <Button
              variant="outline"
              size="lg"
              onClick={onPause}
              disabled={busy}
              className="h-12 flex-1 text-base"
            >
              <Pause data-icon="inline-start" className="size-4" />
              Pause
            </Button>
          )}
          <Button
            variant={view === "paused" || outOfFunds ? "ghost" : "outline"}
            size="lg"
            onClick={onCancel}
            disabled={busy}
            className="h-12 flex-1 text-base"
          >
            {busy ? "Stopping…" : "Cancel"}
          </Button>
        </div>
        <p className="text-center text-xs text-ink-soft">
          Cancel any time. You only pay for the seconds that elapsed.
        </p>
      </div>
    </section>
  );
}
