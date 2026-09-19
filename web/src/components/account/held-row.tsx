/**
 * `HeldRow` — money the subscriber has put up for a merchant-mode session the merchant has not
 * started. Nothing is accruing, so unlike `MeterRow` there is no readout: what is held, and when it
 * comes back if the merchant never starts.
 *
 * There is no Stop. Since the 2026-09-19 amendment a merchant-started meter is the merchant's to
 * stop in every state (contracts FR-CON-057), so the line about when the money returns is the only
 * answer this row can give a subscriber asking for theirs back — which is why it is never omitted.
 *
 * Maps to: FR-CHK-034 (amended), FR-CHK-036, FR-CHK-024; BR-CHK-001.
 */
"use client";

import type { AccountHeld } from "@/lib/account/types";
import { formatReceiptUsd, parseUsd } from "@/lib/checkout/funding";
import { MerchantMark } from "./account-frame";
import { TestTag } from "./meter-row";

export function HeldRow({ held: h }: { held: AccountHeld }) {
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
      </div>
    </article>
  );
}
