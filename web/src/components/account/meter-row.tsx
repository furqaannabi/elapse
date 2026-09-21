/**
 * `MeterRow` — one running meter in the account list: who is charging,
 * for what, the live figure, how much of the cap is left, and one way to
 * stop. FR-CHK-030 withdrawn 2026-09-20: a subscriber never pauses; they ask the merchant
 * (FR-CHK-030). Deliberately compact: a subscriber may have several running, and
 * three tall cards would push the newest one off a phone screen.
 *
 * The card is the same at every width; a wide screen shows more of them
 * side by side (FR-CHK-024) rather than stretching these.
 *
 * A merchant-mode meter the merchant started has neither: only the merchant can stop it (FR-CHK-037).
 *
 * Maps to: FR-CHK-018, FR-CHK-021, FR-CHK-006, FR-CHK-024, FR-CHK-030, FR-CHK-037; BR-CHK-001.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Readout } from "@/components/meter/readout";
import {
  formatCap,
  formatRuntimeShort,
  parseUsd,
  remainingRuntimeMs,
} from "@/lib/checkout/funding";
import type { AccountMeter } from "@/lib/account/types";
import { formatUsd } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";
import { MerchantMark } from "./account-frame";

/** The one mode word on the page: a meter started from a merchant's test link (ADR 2026-09-07 account on real data). */
export function TestTag() {
  return <span className="placard shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-ink-soft">Test</span>;
}

export function MeterRow({
  meter: m,
  busy,
  pending,
  onStop,
}: {
  meter: AccountMeter;
  busy?: boolean;
  /** A pause or resume in flight on this row: the button reads "Pausing…" / "Resuming…" (FR-CHK-018). */
  pending?: "pause" | "resume" | null;
  onStop: () => void;
  /** Present only when the product allows pause. */
}) {
  const paused = m.status === "paused";
  const meter = useMeter({
    rate: m.product.rateUsdPerSecond,
    startedAt: m.startedAt,
    pausedAt: m.pausedAt,
  });
  const cap = parseUsd(m.fundedUsd);
  const remaining = remainingRuntimeMs(cap, meter.rateNano, meter.elapsedMs);
  const low = remaining < 5 * 60_000;

  return (
    <article
      role="group"
      aria-label={`${m.merchant.name} · ${m.product.name}`}
      className="flex h-full flex-col rounded-xl border border-border bg-card"
    >
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <MerchantMark name={m.merchant.name} logoUrl={m.merchant.logoUrl} size={28} />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            <span className="truncate">
              {m.merchant.name}
              <span className="font-normal text-ink-soft"> · {m.product.name}</span>
            </span>
            {m.test && <TestTag />}
          </p>
          <Readout
            elapsed={meter.elapsed}
            accrued={meter.accruedLive}
            running={meter.running}
            size="tiny"
            className="mt-1.5"
          />
          <p className="numerals mt-1 truncate text-xs text-ink-soft">
            {paused ? `Paused · ${formatRuntimeShort(remaining)} left` : `of ${formatUsd(cap)} · ${formatRuntimeShort(remaining)} left`}
          </p>
        </div>

        {m.merchantControlled ? (
          <p className="max-w-[9rem] shrink-0 text-right text-xs text-ink-soft">{m.merchant.name} stops this meter</p>
        ) : (
          <Button
            variant="outline"
            onClick={onStop}
            disabled={busy}
            aria-label={`Stop this meter at ${m.merchant.name}`}
            className="h-11 shrink-0 px-4"
          >
            Stop
          </Button>
        )}
      </div>


      {low && (
        <p role="status" className="mt-auto border-t border-live/30 bg-live-soft px-4 py-2 text-xs">
          About {formatRuntimeShort(remaining)} left of your {formatCap(m.maxDurationSeconds)}. The
          meter stops there.
        </p>
      )}
    </article>
  );
}
