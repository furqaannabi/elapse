/**
 * `CapStep` — choose how long the meter may run. Presets are durations,
 * because that is what the subscriber is buying; beside each is the most
 * it can cost, which is the ceiling they authorise and the contract
 * enforces. There is no adding funds later: the cap is the session.
 *
 * Maps to: FR-CHK-003; BR-CHK-001, BR-CHK-002.
 */
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CAP_PRESETS_SECONDS,
  formatCap,
  maxEscrowNano,
  parseCapMinutes,
  parseUsd,
} from "@/lib/checkout/funding";
import { formatUsd, parseRate } from "@/lib/meter/math";
import { cn } from "@/lib/utils";

export function CapStep({
  rateUsdPerSecond,
  availableUsd,
  busy,
  onChoose,
}: {
  rateUsdPerSecond: string;
  /** What the subscriber can spend, USD decimal string. Omit when unknown. */
  availableUsd?: string;
  busy?: boolean;
  /** Called with the chosen cap in seconds. */
  onChoose: (seconds: number) => void;
}) {
  const rate = useMemo(() => parseRate(rateUsdPerSecond), [rateUsdPerSecond]);
  const available = useMemo(
    () => (availableUsd === undefined ? null : parseUsd(availableUsd)),
    [availableUsd],
  );
  const affordable = (seconds: number) =>
    available === null || maxEscrowNano(seconds, rate) <= available;

  const [choice, setChoice] = useState<number | "custom">(
    CAP_PRESETS_SECONDS.find(affordable) ?? CAP_PRESETS_SECONDS[0],
  );
  const [minutes, setMinutes] = useState("");
  const custom = choice === "custom";

  let seconds: number | null = null;
  if (custom) {
    try {
      const parsed = parseCapMinutes(minutes);
      seconds = affordable(parsed) ? parsed : null;
    } catch {
      seconds = null;
    }
  } else if (affordable(choice)) {
    seconds = choice;
  }

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div>
        <p className="placard">How long may the meter run?</p>
        <p className="mt-1 text-sm text-ink-soft">
          You only pay the seconds you use. Anything unused comes back when you cancel.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How long">
        {CAP_PRESETS_SECONDS.map((preset) => {
          const active = choice === preset;
          const can = affordable(preset);
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!can}
              onClick={() => setChoice(preset)}
              className={cn(
                "flex min-h-[72px] flex-col items-start justify-between rounded-lg border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "border-live bg-live-soft" : "border-border bg-card hover:bg-muted",
                !can && "cursor-not-allowed opacity-40 hover:bg-card",
              )}
            >
              <span className="text-xl">{formatCap(preset)}</span>
              <span className="numerals whitespace-nowrap text-xs text-ink-soft">
                {formatUsd(maxEscrowNano(preset, rate))}
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
          custom ? "border-live bg-live-soft" : "border-border bg-card hover:bg-muted",
        )}
      >
        <span>Another length</span>
        {custom && seconds !== null && (
          <span className="numerals text-xs text-ink-soft">
            {formatUsd(maxEscrowNano(seconds, rate))}
          </span>
        )}
      </button>

      {custom && (
        <div className="relative">
          <Input
            autoFocus
            inputMode="numeric"
            placeholder="30"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="How many minutes"
            className="numerals h-12 pr-20 text-lg"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
            minutes
          </span>
        </div>
      )}

      {available !== null && (
        <p className="numerals text-xs text-ink-soft">
          You have {formatUsd(available)} available.
        </p>
      )}

      <Button
        size="lg"
        disabled={busy || seconds === null}
        onClick={() => seconds !== null && onChoose(seconds)}
        className="mt-auto h-12 w-full text-base"
      >
        {busy ? "One moment…" : seconds === null ? "Enter how long" : "Continue"}
      </Button>
    </section>
  );
}
