/**
 * `HeldRow` — money the subscriber has put up for a merchant-mode session the merchant has not
 * started. Nothing is accruing, so unlike `MeterRow` there is no readout: what is held, when it
 * comes back if the merchant never starts, and Stop. Same card, mark and Stop button as a meter
 * row (DESIGN.md), so the list reads as one kind of thing.
 *
 * Maps to: FR-CHK-036, FR-CHK-024; BR-CHK-001.
 */
"use client";

import { Button } from "@/components/ui/button";
import type { AccountHeld } from "@/lib/account/types";
import { formatReceiptUsd, parseUsd } from "@/lib/checkout/funding";
import { MerchantMark } from "./account-frame";
import { TestTag } from "./meter-row";

export function HeldRow({ held: h, busy, onStop }: { held: AccountHeld; busy?: boolean; onStop: () => void }) {
  const comesBackAt = new Date(h.startBy).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <article
      role="group"
      aria-label={`${h.merchant.name} · ${h.product.name}`}
      className="flex h-full flex-col rounded-xl border border-border bg-card"
    >
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <MerchantMark name={h.merchant.name} logoUrl={h.merchant.logoUrl} size={28} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            <span className="truncate">
              {h.merchant.name}
              <span className="font-normal text-ink-soft"> · {h.product.name}</span>
            </span>
            {h.test && <TestTag />}
          </p>
          <p className="numerals mt-1.5 text-sm">Not started · ${formatReceiptUsd(parseUsd(h.heldUsd))} held</p>
          <p className="mt-1 truncate text-xs text-ink-soft">Comes back at {comesBackAt} if not started</p>
        </div>
        <Button
          variant="outline"
          onClick={onStop}
          disabled={busy}
          aria-label={`Stop this meter at ${h.merchant.name}`}
          className="h-11 shrink-0 px-4"
        >
          Stop
        </Button>
      </div>
    </article>
  );
}
