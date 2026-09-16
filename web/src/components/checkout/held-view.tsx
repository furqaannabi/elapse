/**
 * `HeldView` — a merchant-mode session the subscriber has funded but the merchant has not started.
 *
 * Nothing is accruing, so there is no readout: just what is held, that nothing has been charged,
 * and the clock time at which it all comes back if the merchant never starts (API FR-API-137,
 * the same window the platform's sweep refunds on). Back to the merchant is the expected path;
 * Stop refunds everything now. Built from the meter view's parts (DESIGN.md, no new direction).
 *
 * Maps to: FR-CHK-034; BR-CHK-001 (no chain words), BR-CHK-004 (Stop is a neutral outline).
 */
"use client";

import { ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatReceiptUsd, parseUsd } from "@/lib/checkout/funding";
import type { Subscription } from "@/lib/checkout/types";
import { cn } from "@/lib/utils";

export function HeldView({
  productName,
  merchantName,
  successHref,
  hold,
  busy,
  onStop,
}: {
  productName: string;
  merchantName: string;
  /** Where "Back to {merchant}" goes: `success_url?session_id=cs_…`. */
  successHref: string;
  hold: NonNullable<Subscription["hold"]>;
  busy?: boolean;
  onStop: () => void;
}) {
  const comesBackAt = new Date(hold.startBy).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="placard truncate">{productName}</span>
        </div>
        <div className="flex flex-col gap-3 px-5 pt-6 pb-5">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">
            Waiting for {merchantName} to start
          </h1>
          <p className="numerals text-lg">${formatReceiptUsd(parseUsd(hold.heldUsd))} held</p>
          <p className="text-ink-soft">You haven&apos;t been charged.</p>
          <p className="max-w-[38ch] text-pretty text-sm text-ink-soft">
            If it hasn&apos;t started by {comesBackAt}, it all comes back to you.
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <a href={successHref} className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base")}>
          Back to {merchantName}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </a>
        <Button variant="outline" size="lg" onClick={onStop} disabled={busy} className="h-12 w-full text-base">
          {busy ? "Stopping…" : "Stop"}
        </Button>
      </div>
    </section>
  );
}
