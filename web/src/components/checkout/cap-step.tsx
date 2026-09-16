/**
 * `CapStep` — choose how long the meter may run. Presets are durations,
 * because that is what the subscriber is buying; beside each is the most
 * it can cost, which is the ceiling they authorise and the contract
 * enforces. There is no adding funds later: the cap is the session.
 *
 * A wallet that cannot afford the smallest preset is offered Add funds instead of
 * Continue (FR-CHK-031).
 *
 * Maps to: FR-CHK-003, FR-CHK-031; BR-CHK-001, BR-CHK-002.
 */
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/field-hint";
import { accepted, check, rules } from "@/lib/forms/rules";
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
  initialSeconds,
  busy,
  onChoose,
  onAddMoney,
  waitsForMerchant,
}: {
  rateUsdPerSecond: string;
  /** What the subscriber can spend, USD decimal string. Omit when unknown. */
  availableUsd?: string;
  /** A cap to preselect, e.g. the last one after Start again (FR-CHK-007): a preset when it matches, else the custom minutes. */
  initialSeconds?: number;
  busy?: boolean;
  /** Called with the chosen cap in seconds. */
  onChoose: (seconds: number) => void;
  /** Offered, with the smallest preset, when the wallet cannot afford any preset (FR-CHK-031). */
  onAddMoney?: (seconds: number) => void;
  /** FR-CHK-035: the merchant's name when the product is merchant-started, so billing waits for them. */
  waitsForMerchant?: string;
}) {
  const rate = useMemo(() => parseRate(rateUsdPerSecond), [rateUsdPerSecond]);
  const available = useMemo(
    () => (availableUsd === undefined ? null : parseUsd(availableUsd)),
    [availableUsd],
  );
  const affordable = (seconds: number) =>
    available === null || maxEscrowNano(seconds, rate) <= available;
  const shortOfEverything = available !== null && !CAP_PRESETS_SECONDS.some(affordable);

  const preset = initialSeconds !== undefined && (CAP_PRESETS_SECONDS as readonly number[]).includes(initialSeconds) ? initialSeconds : null;
  const [choice, setChoice] = useState<number | "custom">(
    preset ?? (initialSeconds !== undefined && initialSeconds % 60 === 0 ? "custom" : (CAP_PRESETS_SECONDS.find(affordable) ?? CAP_PRESETS_SECONDS[0])),
  );
  const [minutes, setMinutes] = useState(preset === null && initialSeconds !== undefined && initialSeconds % 60 === 0 ? String(initialSeconds / 60) : "");
  const custom = choice === "custom";

  // FR-CHK-028: whole minutes within the server's bounds (60 s to 30 days), shown as typed.
  const minutesProblem = custom && minutes.trim() ? check(rules.capMinutes, minutes) : null;
  let seconds: number | null = null;
  if (custom) {
    try {
      const parsed = parseCapMinutes(minutes);
      seconds = !minutesProblem && affordable(parsed) ? parsed : null;
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
          You only pay the seconds you use. Anything unused comes back when you stop.
        </p>
        {waitsForMerchant && (
          <p className="mt-1 text-pretty text-sm text-ink-soft">Billing starts when {waitsForMerchant} starts your session.</p>
        )}
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
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Input
              autoFocus
              inputMode="numeric"
              pattern={rules.capMinutes.pattern}
              maxLength={rules.capMinutes.maxLength}
              autoComplete="off"
              placeholder="30"
              value={minutes}
              onChange={(e) => setMinutes((prev) => accepted(rules.capMinutes, prev, e.target.value))}
              aria-label="How many minutes"
              aria-invalid={minutesProblem ? true : undefined}
              aria-describedby="cap-minutes-hint"
              className="numerals h-12 pr-20 text-lg"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
              minutes
            </span>
          </div>
          <FieldHint id="cap-minutes-hint" error={minutesProblem} hint="Between 1 minute and 30 days." />
        </div>
      )}

      {available !== null && (
        <p className="numerals text-xs text-ink-soft">
          You have {formatUsd(available)} available.
        </p>
      )}

      {shortOfEverything && onAddMoney ? (
        <Button size="lg" disabled={busy} onClick={() => onAddMoney(CAP_PRESETS_SECONDS[0])} className="mt-auto h-12 w-full text-base">
          Add funds
        </Button>
      ) : (
        <Button
          size="lg"
          disabled={busy || seconds === null}
          onClick={() => seconds !== null && onChoose(seconds)}
          className="mt-auto h-12 w-full text-base"
        >
          {busy ? "One moment…" : seconds === null ? "Enter how long" : "Continue"}
        </Button>
      )}
    </section>
  );
}
