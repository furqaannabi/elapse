/**
 * `LiveAmount` — a subscription's elapsed time and accrued dollars ticking
 * in a list row. Pairs `useMeter` with the tiny `Readout`; frozen when the
 * subscription is paused, final when canceled.
 *
 * Maps to: FR-DSH-022, FR-DSH-040; FR-MTR-007/008.
 */
"use client";

import { Readout } from "@/components/meter/readout";
import { useMeter } from "@/lib/meter/use-meter";
import type { Subscription } from "@/lib/dashboard/types";

export function LiveAmount({
  subscription,
  size = "tiny",
  className,
}: {
  subscription: Pick<Subscription, "rateUsdPerSecond" | "startedAt" | "pausedAt" | "canceledAt" | "status">;
  size?: "tiny" | "inline" | "panel";
  className?: string;
}) {
  const s = subscription;
  const frozenAt = s.canceledAt ?? s.pausedAt;
  const meter = useMeter({ rate: s.rateUsdPerSecond, startedAt: s.startedAt, pausedAt: frozenAt });
  return (
    <Readout
      size={size}
      elapsed={meter.elapsed}
      accrued={size === "tiny" ? meter.accruedLive : meter.accruedLive}
      running={s.status === "active" && meter.running}
      className={className}
    />
  );
}
