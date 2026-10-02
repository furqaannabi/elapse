/**
 * `DemoBanner` — one line under the mode banner on a demo session: this is the shared demo account,
 * its changes reset every six hours, and the judge can have their own. Nothing is hidden or disabled
 * elsewhere; a write the demo may not make comes back from the API as a toast with its sentence.
 *
 * @param merchant       The signed-in merchant; renders only when `demo` is true.
 * @param onBuildYourOwn Signs out and goes to `/login` (the shell's sign-out).
 *
 * Maps to: FR-DSH-147; API FR-API-152/153; ADR 2026-10-02 demo account.
 */
"use client";

import type { Merchant } from "@/lib/dashboard/types";

export function DemoBanner({ merchant, onBuildYourOwn }: { merchant: Pick<Merchant, "demo">; onBuildYourOwn?: () => void }) {
  if (!merchant.demo) return null;
  return (
    <div role="status" aria-label="Demo account" className="border-b border-border bg-muted px-5 py-1.5 text-[13px] text-foreground md:px-8">
      <span className="font-semibold">You’re in the demo account. Changes reset every 6 hours.</span>{" "}
      <button type="button" onClick={onBuildYourOwn} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-primary md:min-h-0">
        Sign in with your email to build your own →
      </button>
    </div>
  );
}
