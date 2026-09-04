/**
 * `ModeToggle` — the Test / Live segmented control in the top bar.
 *
 * A radio group of two words. Test is the default; switching is immediate
 * and remembered per browser through the mode store. Test carries the
 * caution tint so the mode is never mistaken; Live is ink on paper.
 *
 * Maps to: FR-DSH-003; BR-DSH-002.
 */
"use client";

import { setMode, useMode, type Mode } from "@/lib/dashboard/mode";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
];

export function ModeToggle({ className }: { className?: string }) {
  const mode = useMode();
  return (
    <div
      role="radiogroup"
      aria-label="Data mode"
      className={cn(
        "inline-flex h-8 items-center rounded-lg border border-border bg-background p-0.5",
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const selected = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setMode(o.value)}
            className={cn(
              "h-full min-w-12 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? o.value === "test"
                  ? "bg-caution-soft text-caution"
                  : "bg-primary text-primary-foreground"
                : "text-ink-soft hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
