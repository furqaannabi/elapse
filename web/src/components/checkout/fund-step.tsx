/**
 * `FundStep` — choose how much to load. Presets show the runtime each
 * buys at this product's rate so money reads as time; a custom amount is
 * one tap away. Unused funds return on cancel, and the copy says so.
 *
 * Maps to: FR-CHK-003; BR-CHK-002.
 */
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FUND_PRESETS_USD,
  formatRuntime,
  formatRuntimeShort,
  parseUsd,
  runtimeMsFor,
} from "@/lib/checkout/funding";
import { parseRate } from "@/lib/meter/math";
import { cn } from "@/lib/utils";

export function FundStep({
  rateUsdPerSecond,
  busy,
  mode = "initial",
  onFund,
}: {
  rateUsdPerSecond: string;
  busy?: boolean;
  /** "initial" before the meter starts; "topup" from the running screen. */
  mode?: "initial" | "topup";
  onFund: (usd: string) => void;
}) {
  const rate = useMemo(() => parseRate(rateUsdPerSecond), [rateUsdPerSecond]);
  const [choice, setChoice] = useState<string>(FUND_PRESETS_USD[1]);
  const [custom, setCustom] = useState("");
  const customActive = choice === "custom";

  const amount = customActive ? custom : choice;
  let amountNano: bigint | null = null;
  try {
    amountNano = amount ? parseUsd(amount) : null;
    if (amountNano !== null && amountNano <= 0n) amountNano = null;
  } catch {
    amountNano = null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="placard">{mode === "topup" ? "Add funds" : "How much to load"}</p>
        <p className="mt-1 text-sm text-ink-soft">
          Your maximum spend. Whatever you don&rsquo;t use comes back when you cancel.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Amount">
        {FUND_PRESETS_USD.map((p) => {
          const active = choice === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setChoice(p)}
              className={cn(
                "flex min-h-[72px] flex-col items-start justify-between rounded-lg border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-live bg-live-soft"
                  : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="numerals text-xl">${p}</span>
              <span className="numerals whitespace-nowrap text-xs text-ink-soft">
                {formatRuntimeShort(runtimeMsFor(parseUsd(p), rate))}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setChoice("custom")}
        className={cn(
          "flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          customActive ? "border-live bg-live-soft" : "border-border bg-card hover:bg-muted",
        )}
      >
        <span>Another amount</span>
        {customActive && amountNano !== null && (
          <span className="numerals text-xs text-ink-soft">
            {formatRuntime(runtimeMsFor(amountNano, rate))}
          </span>
        )}
      </button>

      {customActive && (
        <div className="relative">
          <span className="numerals pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
            $
          </span>
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Custom amount in dollars"
            className="numerals h-12 pl-7 text-lg"
          />
        </div>
      )}

      <Button
        size="lg"
        disabled={busy || amountNano === null}
        onClick={() => amountNano !== null && onFund(amount.replace(/^\$/, ""))}
        className="h-12 w-full text-base"
      >
        {busy ? "Adding…" : amountNano !== null ? `Add $${amount.replace(/^\$/, "")}` : "Enter an amount"}
      </Button>
    </section>
  );
}
