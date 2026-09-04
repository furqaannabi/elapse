/**
 * `ProductDrawer` — create / edit a product: name, rate per second (a
 * decimal string; per-minute and per-hour computed live from the meter
 * math, never a float), description, allow pause. A sheet from the right
 * on desktop, full-screen below `md`.
 *
 * Maps to: FR-DSH-031; BR-DSH-007.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RATE_PATTERN, type ProductInput } from "@/lib/dashboard/mock-api";
import type { Product } from "@/lib/dashboard/types";
import { formatUsd, parseRate, perHour, perMinute } from "@/lib/meter/math";

export function ProductDrawer({
  open,
  initial,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial?: Product;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ProductInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rate, setRate] = useState(initial?.rateUsdPerSecond ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [allowPause, setAllowPause] = useState(initial?.allowPause ?? false);

  const valid = RATE_PATTERN.test(rate.trim());
  const nano = valid ? parseRate(rate.trim()) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onCancel()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), rateUsdPerSecond: rate.trim(), description: description.trim() || null, allowPause });
          }}
          className="flex min-h-full flex-col"
          noValidate
        >
          <SheetHeader className="border-b border-border px-5 py-4 pr-14">
            <SheetTitle>{initial ? "Edit product" : "New product"}</SheetTitle>
            <SheetDescription>Something billed by the second. The rate is what a subscriber sees on checkout.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-5 px-5 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-name">Name</Label>
              <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="GPU · 4090" autoFocus className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-rate">Rate per second (USD)</Label>
              <div className="flex items-center gap-2">
                <span className="numerals text-[15px] text-ink-soft">$</span>
                <Input
                  id="product-rate"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="0.004"
                  inputMode="decimal"
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  className="numerals h-10 text-[15px]"
                />
              </div>
              <p className="numerals text-[13px] text-ink-soft" aria-live="polite">
                {nano !== null && nano > 0n ? (
                  <>
                    {formatUsd(perMinute(nano), 2)} / min · {formatUsd(perHour(nano), 2)} / hour
                  </>
                ) : (
                  "Up to 9 decimal places."
                )}
              </p>
              {error && (
                <p role="alert" className="text-[13px] text-caution">
                  {error}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-description">
                Description <span className="font-normal text-ink-soft">(optional)</span>
              </Label>
              <Textarea id="product-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="text-[14px]" />
            </div>
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
              <span>
                <span className="block text-[14px] font-medium">Allow pause</span>
                <span className="block text-[12px] text-ink-soft">Subscribers can pause the meter and resume later. Off by default.</span>
              </span>
              <Switch checked={allowPause} onCheckedChange={setAllowPause} aria-label="Allow pause" />
            </label>
          </div>
          <SheetFooter className="flex-col-reverse border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancel} className="h-9">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="h-9">
              {busy ? "Saving…" : initial ? "Save" : "Create product"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
