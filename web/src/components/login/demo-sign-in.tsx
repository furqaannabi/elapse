/**
 * `DemoSignIn` — "Try the demo account" on `/login`. Pressing it reveals six single-digit boxes;
 * the sixth digit (typed or pasted) submits the PIN. A wrong PIN clears the boxes and puts focus back
 * on the first; a limit says how long to wait, from the server's `Retry-After`.
 *
 * @param signInDemo Sends the PIN; rejects with `DemoPinRefused` when it is refused.
 * @param onSignedIn Called once the demo session is open (the caller navigates).
 * @param prominent  `/login?demo=1`: the button is the page's primary action.
 *
 * Maps to: FR-DSH-146; API FR-API-152; ADR 2026-10-02 demo account.
 */
"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { DemoPinRefused, type DemoPinCode } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

const LENGTH = 6;

function minutes(seconds: number | null): string {
  const m = Math.max(1, Math.ceil((seconds ?? 60) / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

function refusalSentence(code: DemoPinCode, retryAfter: number | null): string {
  switch (code) {
    case "demo_pin_invalid":
      return "That PIN isn’t right.";
    case "demo_pin_ip_limited":
      return `Too many tries. Try again in ${minutes(retryAfter)}.`;
    case "demo_pin_paused":
      return `The demo is resting after too many wrong PINs. Try again in ${minutes(retryAfter)}.`;
    case "rate_limited":
      return `Too many demo sign-ins from here. Try again in ${minutes(retryAfter)}.`;
  }
}

export function DemoSignIn({ signInDemo, onSignedIn, prominent = false }: { signInDemo: (pin: string) => Promise<Merchant>; onSignedIn: () => void; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const focus = (i: number) => refs.current[Math.min(Math.max(i, 0), LENGTH - 1)]?.focus();

  const submit = async (pin: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInDemo(pin);
      onSignedIn();
    } catch (e) {
      setError(e instanceof DemoPinRefused ? refusalSentence(e.code, e.retryAfterSeconds) : "We couldn’t reach Elapse. Try again.");
      setDigits(Array(LENGTH).fill(""));
      // After React has cleared the boxes, so the cursor lands in an empty first box.
      setTimeout(() => focus(0), 0);
    } finally {
      setBusy(false);
    }
  };

  /** Writes `typed` digits starting at box `at`; submits when all six are filled. */
  const fill = (at: number, typed: string) => {
    const only = typed.replace(/\D/g, "");
    if (!only) return;
    const next = [...digits];
    let i = at;
    for (const d of only) {
      if (i >= LENGTH) break;
      next[i] = d;
      i += 1;
    }
    setDigits(next);
    if (next.every((d) => d !== "")) void submit(next.join(""));
    else focus(i);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      focus(i - 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(i, e.clipboardData.getData("text"));
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant={prominent ? "default" : "outline"}
        size="lg"
        onClick={() => {
          setOpen(true);
          setTimeout(() => focus(0), 0);
        }}
        className="h-11 w-full text-[15px]"
      >
        Try the demo account
      </Button>
    );
  }

  return (
    <div role="group" aria-labelledby="demo-pin-title" className="flex flex-col gap-3">
      <p id="demo-pin-title" className="text-[15px] font-semibold">
        Enter the demo PIN
      </p>
      <div className="flex gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`Digit ${i + 1} of ${LENGTH}`}
            value={d}
            onChange={(e) => fill(i, e.target.value.slice(-1))}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={busy}
            className={cn(
              "numerals h-12 w-11 min-w-0 flex-1 rounded-md border border-border bg-background text-center text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
              error && "border-destructive/60",
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="min-h-5 text-[13px] text-ink-soft">
        {busy ? "Signing in…" : error}
      </p>
    </div>
  );
}
