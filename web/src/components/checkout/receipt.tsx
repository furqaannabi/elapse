/**
 * `Receipt` — what happened, in one line and a short breakdown. The hero
 * line is the product's promise: "You paid 83 seconds · $0.33". A session
 * that used its whole cap says so and offers another, since the cap is
 * fixed once signed (FR-CHK-007). Then the merchant's success URL and a
 * mocked email receipt.
 *
 * Maps to: FR-CHK-007, FR-CHK-008, FR-CHK-009; BR-CHK-003.
 */
"use client";

import { ArrowRight, Mail, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatCap } from "@/lib/checkout/funding";
import type { Receipt as ReceiptData } from "@/lib/checkout/mock-api";
import type { Branding, Product } from "@/lib/checkout/types";
import { cn } from "@/lib/utils";

export function Receipt({
  receipt,
  product,
  merchant,
  successHref,
  maxDurationSeconds,
  onStartAgain,
  startBusy,
  onEmail,
  emailBusy,
}: {
  receipt: ReceiptData;
  product: Product;
  merchant: Branding;
  successHref: string;
  /** The cap this session ran under, for the "your 1 hour is up" line. */
  maxDurationSeconds?: number;
  onStartAgain?: () => void;
  startBusy?: boolean;
  /** Absent = the email receipt is not offered (the real API grows it in Week 4). */
  onEmail?: () => void;
  emailBusy?: boolean;
}) {
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const s = receipt.secondsElapsed;
  const cappedOut = receipt.endedReason === "cap_reached";

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl border border-border bg-card px-5 py-6">
        <p className="placard">Stopped</p>
        {cappedOut && maxDurationSeconds !== undefined && (
          <p className="mt-2 text-sm text-ink-soft">
            Your {formatCap(maxDurationSeconds)} is up.
          </p>
        )}
        <p className="display-wide mt-2 text-balance text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
          You paid{" "}
          <span className="whitespace-nowrap">{s} {s === 1 ? "second" : "seconds"} ·</span>{" "}
          <span className="numerals whitespace-nowrap text-live">${receipt.amountSettledUsd}</span>
        </p>
        <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-soft">Product</dt>
          <dd className="text-right">{product.name}</dd>
          <dt className="text-ink-soft">Rate</dt>
          <dd className="numerals text-right">${receipt.rateUsdPerSecond} / second</dd>
          <dt className="text-ink-soft">Started</dt>
          <dd className="numerals text-right">{time(receipt.startedAt)}</dd>
          <dt className="text-ink-soft">Stopped</dt>
          <dd className="numerals text-right">{time(receipt.canceledAt)}</dd>
          <dt className="text-ink-soft">Charged</dt>
          <dd className="numerals text-right">${receipt.amountSettledUsd}</dd>
          <dt className="text-ink-soft">Returned to you</dt>
          <dd className="numerals text-right">${receipt.refundedUsd}</dd>
        </dl>
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {cappedOut && onStartAgain && (
          <Button
            size="lg"
            variant="outline"
            onClick={onStartAgain}
            disabled={startBusy}
            className="h-12 w-full text-base"
          >
            <RotateCcw data-icon="inline-start" className="size-4" />
            {startBusy ? "Opening…" : "Start again"}
          </Button>
        )}
        <a href={successHref} className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base")}>
          Back to {merchant.name}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </a>
        {onEmail && (
        <Button
            variant="outline"
            size="lg"
            onClick={onEmail}
            disabled={emailBusy}
            className="h-12 w-full text-base"
          >
            <Mail data-icon="inline-start" className="size-4" />
            {emailBusy ? "Sending…" : "Email receipt"}
          </Button>
        )}
        <a
          href="/account"
          className="py-1 text-center text-xs !text-ink-soft underline-offset-3 hover:!text-foreground"
        >
          Manage your meters
        </a>
      </div>
    </section>
  );
}
