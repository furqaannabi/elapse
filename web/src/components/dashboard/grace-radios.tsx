/**
 * `GraceRadios` — "expire the old one: now / 1 h / 24 h". Shared by key
 * and signing-secret rolls. Native radios stay in the DOM for a11y; the
 * visible control is a hairline ring with a filled centre when chosen,
 * the one shape every merchant reads as "one of these".
 *
 * Maps to: FR-DSH-072, FR-DSH-082.
 */
"use client";

import { cn } from "@/lib/utils";

export const GRACE_OPTIONS = [
  { label: "Now", detail: "The old one stops working immediately", ms: 0 },
  { label: "In 1 hour", detail: "Deploy the new one first", ms: 3_600_000 },
  { label: "In 24 hours", detail: "Stripe's default", ms: 86_400_000 },
] as const;

export function GraceRadios({ value, onChange, name = "grace" }: { value: number; onChange: (ms: number) => void; name?: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="sr-only">Expire the old one</legend>
      {GRACE_OPTIONS.map((o) => (
        <label
          key={o.ms}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
            value === o.ms ? "border-foreground/40 bg-muted" : "border-border hover:bg-muted/60",
          )}
        >
          <input type="radio" name={name} value={o.ms} checked={value === o.ms} onChange={() => onChange(o.ms)} className="peer sr-only" />
          <span
            aria-hidden
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              value === o.ms ? "border-foreground" : "border-input",
            )}
          >
            {value === o.ms && <span className="size-2 rounded-full bg-foreground" />}
          </span>
          <span className="flex-1">
            <span className="block text-[14px] font-medium">{o.label}</span>
            <span className="block text-[12px] text-ink-soft">{o.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
