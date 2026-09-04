/**
 * `ReceiptRow` and `ReceiptSheet` — the finished sessions. The row is the
 * product's promise in one line; the sheet is the checkout receipt again,
 * so a subscriber sees the same words twice and learns nothing new.
 *
 * A fee is never shown: the subscriber pays the gross, and what the
 * merchant nets is between the merchant and Elapse (FR-CHK-020).
 *
 * Maps to: FR-CHK-020; BR-CHK-003.
 */
"use client";

import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AccountReceipt } from "@/lib/account/types";
import { formatCap } from "@/lib/checkout/funding";
import { MerchantMark } from "./account-frame";

const day = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function ReceiptRow({ receipt: r, onOpen }: { receipt: AccountReceipt; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <MerchantMark name={r.merchant.name} logoUrl={r.merchant.logoUrl} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight">
          You paid{" "}
          <span className="numerals whitespace-nowrap text-[13px]">
            {r.seconds} {r.seconds === 1 ? "second" : "seconds"} ·{" "}
            <span className="text-live">${r.amountSettledUsd}</span>
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-soft">
          {r.merchant.name} · {r.product.name} · <span className="numerals">{day(r.settledAt)}</span>
        </span>
      </span>
    </button>
  );
}

export function ReceiptSheet({
  receipt: r,
  open,
  onOpenChange,
  onEmail,
  emailBusy,
}: {
  receipt: AccountReceipt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmail: () => void;
  emailBusy?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-[480px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        {r && (
          <>
            <SheetHeader className="px-0 pt-4">
              <SheetTitle className="display-wide text-balance text-[1.5rem] font-semibold leading-tight tracking-[-0.025em]">
                You paid{" "}
                <span className="whitespace-nowrap numerals">
                  {r.seconds} {r.seconds === 1 ? "second" : "seconds"} ·
                </span>{" "}
                <span className="numerals whitespace-nowrap text-live">${r.amountSettledUsd}</span>
              </SheetTitle>
              <SheetDescription className="text-sm">
                {r.endedReason === "cap_reached"
                  ? `Your ${formatCap(r.maxDurationSeconds)} was up.`
                  : `At ${r.merchant.name}.`}
              </SheetDescription>
            </SheetHeader>

            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-soft">Merchant</dt>
              <dd className="text-right">{r.merchant.name}</dd>
              <dt className="text-ink-soft">Product</dt>
              <dd className="text-right">{r.product.name}</dd>
              <dt className="text-ink-soft">Rate</dt>
              <dd className="numerals text-right">${r.product.rateUsdPerSecond} / second</dd>
              <dt className="text-ink-soft">Started</dt>
              <dd className="numerals text-right">{clock(r.startedAt)}</dd>
              <dt className="text-ink-soft">Stopped</dt>
              <dd className="numerals text-right">{clock(r.settledAt)}</dd>
              <dt className="text-ink-soft">Charged</dt>
              <dd className="numerals text-right">${r.amountSettledUsd}</dd>
              <dt className="text-ink-soft">Returned to you</dt>
              <dd className="numerals text-right">${r.refundedUsd}</dd>
            </dl>

            <Button
              variant="outline"
              size="lg"
              onClick={onEmail}
              disabled={emailBusy}
              className="mt-5 h-12 w-full text-base"
            >
              <Mail data-icon="inline-start" className="size-4" />
              {emailBusy ? "Sending…" : "Email receipt"}
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
