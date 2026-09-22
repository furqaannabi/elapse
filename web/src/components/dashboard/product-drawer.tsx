/**
 * `ProductDrawer` — create / edit a product: name, rate per second (a
 * decimal string; per-minute and per-hour computed live from the meter
 * math, never a float), description, allow pause. A sheet from the right
 * on desktop, full-screen below `md`.
 *
 * Create validates name and rate live against the shared rules and blocks submit until they
 * pass; a server rejection lands under the field it names. On edit the rate is read-only
 * (FR-API-011: one product, one rate) with a line pointing at a new product.
 *
 * @param error - A server rejection mapped to a field, or a form-level message.
 *
 * Maps to: FR-DSH-031, FR-DSH-114, FR-DSH-115, FR-DSH-116; BR-DSH-007.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ProductInput } from "@/lib/dashboard/mock-api";
import { accepted, check, rules } from "@/lib/forms/rules";
import { FieldHint } from "@/components/ui/field-hint";
import type { Product } from "@/lib/dashboard/types";
import { formatUsd, parseRate, perHour, perMinute } from "@/lib/meter/math";

/**
 * FR-DSH-144. The second option names `subscriptions.start` because the merchant has to call it,
 * and names the refund (FR-API-127) because that is what forgetting costs the subscriber.
 */
const START_MODES = [
  { value: "checkout", label: "At checkout", hint: "The meter starts the moment the subscriber authorises." },
  { value: "merchant", label: "When your code starts it", hint: "The meter waits for subscriptions.start. A session you never start refunds in full after 15 minutes." },
] as const;

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
  error: { field?: "name" | "rate" | "description"; message: string } | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: ProductInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rate, setRate] = useState(initial?.rateUsdPerSecond ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [allowPause, setAllowPause] = useState(initial?.allowPause ?? false);
  const [startMode, setStartMode] = useState<"checkout" | "merchant">(initial?.startMode ?? "checkout");

  const editing = initial !== undefined;
  const nameProblem = check(rules.productName, name);
  const rateProblem = editing ? null : check(rules.rate, rate);
  const descriptionProblem = check(rules.description, description);
  const valid = !nameProblem && !rateProblem && !descriptionProblem;
  const nano = rateProblem === null && rate.trim() ? parseRate(rate.trim()) : null;
  // A rule is shown only once the field has been touched, so an empty drawer is not a wall of hints.
  const [touched, setTouched] = useState<{ name?: boolean; rate?: boolean }>({});
  const serverFor = (f: "name" | "rate" | "description") => (error?.field === f ? error.message : null);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onCancel()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({ name: name.trim(), rateUsdPerSecond: editing ? initial.rateUsdPerSecond : rate.trim(), description: description.trim() || null, allowPause, startMode: editing ? initial.startMode : startMode });
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
              <Input
                id="product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder="GPU · 4090"
                autoFocus
                maxLength={rules.productName.maxLength}
                autoComplete="off"
                aria-invalid={serverFor("name") || (touched.name && nameProblem) ? true : undefined}
                aria-describedby="product-name-hint"
                className="h-10"
              />
              <FieldHint id="product-name-hint" error={serverFor("name") ?? (touched.name ? nameProblem : null)} />
            </div>
            {editing ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-medium">Rate per second (USD)</span>
                <p className="numerals text-[15px]">${initial.rateUsdPerSecond} / second</p>
                <p className="text-[13px] text-ink-soft">To change the rate, create a new product.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-rate">Rate per second (USD)</Label>
                <div className="flex items-center gap-2">
                  <span className="numerals text-[15px] text-ink-soft">$</span>
                  <Input
                    id="product-rate"
                    value={rate}
                    onChange={(e) => setRate((prev) => accepted(rules.rate, prev, e.target.value))}
                    onBlur={() => setTouched((t) => ({ ...t, rate: true }))}
                    placeholder="0.004"
                    inputMode="decimal"
                    maxLength={rules.rate.maxLength}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={serverFor("rate") || (rate && rateProblem) ? true : undefined}
                    aria-describedby="product-rate-hint"
                    className="numerals h-10 text-[15px]"
                  />
                </div>
                <FieldHint
                  id="product-rate-hint"
                  error={serverFor("rate") ?? (rate.trim() ? rateProblem : null)}
                  hint={
                    nano !== null && nano > 0n ? (
                      <span className="numerals">
                        {formatUsd(perMinute(nano), 2)} / min · {formatUsd(perHour(nano), 2)} / hour
                      </span>
                    ) : (
                      "A decimal like 0.004, up to 6 decimal places."
                    )
                  }
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-description">
                Description <span className="font-normal text-ink-soft">(optional)</span>
              </Label>
              <Textarea
                id="product-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={rules.description.maxLength}
                aria-invalid={serverFor("description") ? true : undefined}
                aria-describedby="product-description-hint"
                className="text-[14px]"
              />
              <FieldHint id="product-description-hint" error={serverFor("description") ?? descriptionProblem} />
            </div>
            {/* FR-DSH-144: the behaviour is in the label — `checkout` and `merchant` are API words
                and never reach this surface. Native radios rather than a new primitive: two options
                in a bordered card the Allow pause row below already establishes. */}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[14px] font-medium">Start the meter</legend>
              {editing ? (
                <>
                  <p className="text-[15px]">{initial.startMode === "merchant" ? "When your code starts it" : "At checkout"}</p>
                  <p className="text-[13px] text-ink-soft">To change this, create a new product.</p>
                </>
              ) : (
                START_MODES.map((m) => (
                  <label key={m.value} className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 has-[:checked]:border-foreground/35">
                    <input
                      type="radio"
                      name="product-start-mode"
                      value={m.value}
                      checked={startMode === m.value}
                      onChange={() => setStartMode(m.value)}
                      className="mt-1 size-4 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block text-[14px] font-medium">{m.label}</span>
                      <span className="block text-[12px] text-ink-soft">{m.hint}</span>
                    </span>
                  </label>
                ))
              )}
            </fieldset>
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
            {error && !error.field && (
              <p role="alert" className="text-[13px] text-caution sm:mr-auto">
                {error.message}
              </p>
            )}
            <Button type="submit" disabled={busy || !valid} className="h-9">
              {busy ? "Saving…" : initial ? "Save" : "Create product"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
