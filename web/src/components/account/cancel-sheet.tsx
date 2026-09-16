/**
 * `CancelSheet` — the confirmation before a meter is stopped from the
 * account list. The checkout's own Cancel is one tap because there is only
 * one meter on screen; here several merchants are listed, so a mis-tap
 * would stop the wrong one. The amount keeps ticking while it is open, so
 * the number the subscriber agrees to is the number they pay.
 *
 * A held session (FR-CHK-036) has accrued nothing, so the sheet says so instead of a live cost.
 *
 * Maps to: FR-CHK-019, FR-CHK-036.
 */
"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AccountHeld, AccountMeter } from "@/lib/account/types";
import { formatUsd, settledNano } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";

export function CancelSheet({
  meter: m,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  meter: AccountMeter | AccountHeld | null;
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-[480px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        {m && "heldUsd" in m && <HeldBody held={m} busy={busy} onConfirm={onConfirm} onCancel={() => onOpenChange(false)} />}
        {m && !("heldUsd" in m) && <CancelBody meter={m} busy={busy} onConfirm={onConfirm} onCancel={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function HeldBody({
  held: h,
  busy,
  onConfirm,
  onCancel,
}: {
  held: AccountHeld;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <SheetHeader className="px-0 pt-4">
        <SheetTitle className="text-base">Stop the meter at {h.merchant.name}?</SheetTitle>
        <SheetDescription className="text-sm">You haven&rsquo;t been charged. All of it comes back.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={onConfirm} disabled={busy} className="h-12 w-full text-base">
          {busy ? "Stopping…" : "Stop the meter"}
        </Button>
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={busy} className="h-12 w-full text-base">
          Keep it
        </Button>
      </div>
    </>
  );
}

function CancelBody({
  meter: m,
  busy,
  onConfirm,
  onCancel,
}: {
  meter: AccountMeter;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const meter = useMeter({
    rate: m.product.rateUsdPerSecond,
    startedAt: m.startedAt,
    pausedAt: m.pausedAt,
  });
  // What will actually settle: whole seconds x rate, matching the contract
  // (BR-CHK-003). The live figure carries fractions the receipt never bills.
  const seconds = Math.floor(meter.elapsedMs / 1000);
  const owed = formatUsd(settledNano(meter.rateNano, seconds), 3);

  return (
    <>
      <SheetHeader className="px-0 pt-4">
        <SheetTitle className="text-base">Stop the meter at {m.merchant.name}?</SheetTitle>
        <SheetDescription className="text-sm">
          You&rsquo;ll pay{" "}
          <span className="numerals whitespace-nowrap">
            {seconds} {seconds === 1 ? "second" : "seconds"} · <span className="text-live">{owed}</span>
          </span>{" "}
          so far. The rest comes back.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={onConfirm} disabled={busy} className="h-12 w-full text-base">
          {busy ? "Stopping…" : "Stop the meter"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={busy}
          className="h-12 w-full text-base"
        >
          Keep running
        </Button>
      </div>
    </>
  );
}
