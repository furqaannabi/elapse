/**
 * `Receipt` — what happened, in one line and a short breakdown. The hero
 * line is the product's promise: "You paid 83 seconds · $0.33". Then the
 * merchant's success URL and a mocked email receipt.
 *
 * Maps to: FR-CHK-008, FR-CHK-009; BR-CHK-003.
 */
"use client";

import { ArrowRight, Mail } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Receipt as ReceiptData } from "@/lib/checkout/mock-api";
import type { Branding, Product } from "@/lib/checkout/types";
import { cn } from "@/lib/utils";

export function Receipt({
  receipt,
  product,
  merchant,
  successHref,
  onEmail,
  emailBusy,
}: {
  receipt: ReceiptData;
  product: Product;
  merchant: Branding;
  successHref: string;
  onEmail: () => void;
  emailBusy?: boolean;
}) {
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const s = receipt.secondsElapsed;

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl border border-border bg-card px-5 py-6">
        <p className="placard">Stopped</p>
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
        <a href={successHref} className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base")}>
          Back to {merchant.name}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </a>
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
      </div>
    </section>
  );
}
