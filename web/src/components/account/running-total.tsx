/**
 * `RunningTotal` — the answer to "what am I paying right now", above the
 * fold and independent of how many meters are running. One live sum
 * across every merchant, plus the combined burn rate.
 *
 * Without it the page only answers that question by scrolling, which is
 * the wrong shape for a subscriber checking their phone.
 *
 * Maps to: FR-CHK-018, FR-CHK-024.
 */
"use client";

import { useEffect, useState } from "react";
import type { AccountMeter } from "@/lib/account/types";
import { accruedNano, elapsedMs, formatUsd, parseRate, perHour } from "@/lib/meter/math";

export function RunningTotal({ meters }: { meters: AccountMeter[] }) {
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = meters.some((m) => !m.pausedAt);

  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [anyRunning]);

  if (meters.length === 0) return null;

  let accrued = 0n;
  let rate = 0n;
  for (const m of meters) {
    const r = parseRate(m.product.rateUsdPerSecond);
    accrued += accruedNano(r, elapsedMs({ startedAt: m.startedAt, now, pausedAt: m.pausedAt }));
    if (!m.pausedAt) rate += r;
  }

  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4 lg:flex lg:items-end lg:justify-between lg:gap-6">
      <div>
        <p className="placard">
          {meters.length} {meters.length === 1 ? "meter" : "meters"} running
        </p>
        <p className="numerals mt-1 text-[2rem] leading-none text-live">{formatUsd(accrued, 3)}</p>
      </div>
      <p className="numerals mt-2 text-sm text-ink-soft lg:mt-0">
        {formatUsd(perHour(rate))} / hour while they run
      </p>
    </section>
  );
}
