/**
 * `Readout` — the instrument face of the meter: elapsed time and accrued
 * dollars set in tabular numerals so nothing shifts as digits change.
 *
 * Four sizes: `hero` (checkout), `panel` (inside an instrument card),
 * `inline` (tables, detail pages), `tiny` (dashboard lists). The component is purely presentational;
 * pair it with `useMeter` for live values.
 *
 * @param elapsed - Digit groups from `formatElapsed(ms, { parts: true })`.
 * @param accrued - Formatted amount, e.g. "$0.332".
 * @param running - True while the pen is down; drives the state dot.
 * @param size - Visual scale.
 * @param label - Optional placard beneath (e.g. product name).
 */
"use client";

import { cn } from "@/lib/utils";
import type { ElapsedParts } from "@/lib/meter/math";

export type ReadoutProps = {
  elapsed: ElapsedParts;
  accrued: string;
  running: boolean;
  size?: "hero" | "panel" | "inline" | "tiny";
  label?: string;
  className?: string;
};

const sizes = {
  hero: {
    wrap: "gap-1",
    time: "text-[clamp(2.75rem,9vw,5.5rem)] leading-none",
    tenths: "text-[0.42em] ml-[0.08em]",
    amount: "text-[clamp(1.75rem,5.5vw,3.25rem)] leading-none",
    placard: "mt-3",
  },
  panel: {
    wrap: "gap-1",
    time: "text-[clamp(2.5rem,5.6vw,4.25rem)] leading-none",
    tenths: "text-[0.42em] ml-[0.08em]",
    amount: "text-[clamp(1.5rem,3.4vw,2.5rem)] leading-none",
    placard: "mt-3",
  },
  inline: {
    wrap: "gap-0.5",
    time: "text-2xl leading-none",
    tenths: "text-[0.5em] ml-[0.06em]",
    amount: "text-lg leading-none",
    placard: "mt-1.5",
  },
  tiny: {
    wrap: "gap-0 flex-row items-baseline",
    time: "text-sm leading-none",
    tenths: "hidden",
    amount: "text-sm leading-none ml-3",
    placard: "hidden",
  },
} as const;

export function Readout({
  elapsed,
  accrued,
  running,
  size = "hero",
  label,
  className,
}: ReadoutProps) {
  const s = sizes[size];
  const timeLabel = `${elapsed.hours}:${elapsed.minutes}:${elapsed.seconds}`;
  return (
    <div
      className={cn("flex flex-col", s.wrap, className)}
      role="timer"
      aria-live="off"
      aria-label={`Elapsed ${timeLabel}, accrued ${accrued}`}
    >
      <div className={cn("numerals flex items-baseline text-foreground", s.time)}>
        <span>{elapsed.hours}</span>
        <span className="opacity-40">:</span>
        <span>{elapsed.minutes}</span>
        <span className="opacity-40">:</span>
        <span>{elapsed.seconds}</span>
        <span className={cn("numerals text-ink-soft", s.tenths)}>
          .{elapsed.tenths}
        </span>
      </div>
      <div
        className={cn(
          "numerals flex items-center gap-3 transition-colors duration-300",
          running ? "text-live" : "text-foreground",
          s.amount,
        )}
      >
        <span>{accrued}</span>
        {size !== "tiny" && (
          <span
            aria-hidden
            className={cn(
              "inline-block size-[0.22em] rounded-full transition-colors duration-300",
              running ? "bg-live" : "bg-ink-soft/40",
            )}
          />
        )}
      </div>
      {label && size !== "tiny" && (
        <div className={cn("placard", s.placard)}>{label}</div>
      )}
    </div>
  );
}
