/**
 * `MeterView` — the running meter on a phone: the readout, what it costs,
 * how much of the chosen cap is left, and one Cancel. Pause appears only
 * when the product allows it. Low balance is an amber notice inside the
 * same panel, not a new screen, so the counter never disappears.
 *
 * There is no way to add funds: the cap is the session, and reaching it
 * ends the meter rather than pausing it (FR-CHK-007).
 *
 * Maps to: FR-CHK-005, FR-CHK-006, FR-CHK-007; BR-CHK-004.
 */
"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartStrip, type Session } from "@/components/meter/chart-strip";
import { Readout } from "@/components/meter/readout";
import { formatCap, formatRuntime, remainingRuntimeMs, parseUsd } from "@/lib/checkout/funding";
import type { CheckoutView, Product, Subscription } from "@/lib/checkout/types";
import { formatUsd, perHour } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";

export function MeterView({
  product,
  subscription,
  view,
  busy,
  onCancel,
  onPause,
  onResume,
}: {
  product: Product;
  subscription: Subscription;
  view: Extract<CheckoutView, "running" | "low_balance" | "paused">;
  busy?: boolean;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const meter = useMeter({
    rate: subscription.rateUsdPerSecond,
    startedAt: subscription.startedAt,
    pausedAt: subscription.pausedAt,
  });
  const cap = parseUsd(subscription.fundedUsd);
  const remaining = remainingRuntimeMs(cap, meter.rateNano, meter.elapsedMs);
  const capName = formatCap(subscription.maxDurationSeconds);
  const sessions: Session[] = subscription.startedAt
    ? [{ start: subscription.startedAt, end: subscription.pausedAt }]
    : [];
  const started = subscription.startedAt
    ? new Date(subscription.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const paused = view === "paused";

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
            <dd className="text-right">{paused ? "Paused" : "Running"}</dd>
            {started && (
              <>
                <dt className="text-ink-soft">Started</dt>
                <dd className="numerals text-right">{started}</dd>
              </>
            )}
            <dt className="text-ink-soft">Left of your {capName}</dt>
            <dd className="numerals whitespace-nowrap text-right">
              {formatRuntime(remaining).replace("≈ ", "")}
              <span className="text-ink-soft">
                {" "}
                · {formatUsd(cap - meter.accruedNano > 0n ? cap - meter.accruedNano : 0n)}
              </span>
            </dd>
            <dt className="text-ink-soft">At this rate</dt>
            <dd className="numerals text-right">{formatUsd(perHour(meter.rateNano))} / hour</dd>
          </dl>
        </div>

        <div className="border-t border-border bg-paper/40">
          <ChartStrip sessions={sessions} height={96} level={0.55} pxPerSecond={24} />
        </div>
      </div>

      {view === "low_balance" && (
        <div
          role="status"
          className="rounded-lg border border-live/40 bg-live-soft px-4 py-3 text-sm"
        >
          <span className="font-medium">
            About {formatRuntime(remaining).replace("≈ ", "")} left of your {capName}. The meter
            stops there.
          </span>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {view === "paused" && (
          <Button size="lg" onClick={onResume} disabled={busy} className="h-12 w-full text-base">
            <Play data-icon="inline-start" className="size-4" />
            Resume
          </Button>
        )}
        <div className="flex gap-2">
          {product.allowPause && view !== "paused" && (
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
            variant={paused ? "ghost" : "outline"}
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
