/**
 * `MeterRow` — one running meter in the account list: who is charging,
 * for what, the live figure, how much of the cap is left, and one way to
 * stop. Deliberately compact: a subscriber may have several running, and
 * three tall cards would push the newest one off a phone screen.
 *
 * The card is the same at every width; a wide screen shows more of them
 * side by side (FR-CHK-024) rather than stretching these.
 *
 * Maps to: FR-CHK-018, FR-CHK-021, FR-CHK-006, FR-CHK-024; BR-CHK-001.
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

export function MeterRow({
  meter: m,
  busy,
  onStop,
}: {
  meter: AccountMeter;
  busy?: boolean;
  onStop: () => void;
}) {
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
          <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {m.merchant.name}
            <span className="font-normal text-ink-soft"> · {m.product.name}</span>
          </p>
          <Readout
            elapsed={meter.elapsed}
            accrued={meter.accruedLive}
            running={meter.running}
            size="tiny"
            className="mt-1.5"
          />
          <p className="numerals mt-1 truncate text-xs text-ink-soft">
            of {formatUsd(cap)} · {formatRuntimeShort(remaining)} left
          </p>
        </div>

        <Button
          variant="outline"
          onClick={onStop}
          disabled={busy}
          aria-label={`Stop this meter at ${m.merchant.name}`}
          className="h-11 shrink-0 px-4"
        >
          Stop
        </Button>
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
