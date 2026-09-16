/**
 * `AuthorisedView` — the moment after a subscriber authorises a merchant-mode session. There is no
 * meter to show: the merchant starts it. The page is already on its way back to the merchant, and
 * only if the funding is slow to confirm does it offer the way back by hand.
 *
 * Maps to: FR-CHK-033; BR-CHK-001 (no chain words).
 */
"use client";

import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AuthorisedView({
  merchantName,
  successHref,
  stillWaiting,
}: {
  merchantName: string;
  successHref: string;
  /** True once the automatic return has given up waiting (20 s): show the button instead. */
  stillWaiting: boolean;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 py-10" aria-live="polite">
      <div>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">
          Authorised — taking you back to {merchantName}
        </h1>
        <p className="mt-3 max-w-[38ch] text-pretty text-ink-soft">
          You haven&apos;t been charged. Billing starts when {merchantName} starts your session.
        </p>
      </div>
      {stillWaiting && (
        <a href={successHref} className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base")}>
          Back to {merchantName}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </a>
      )}
    </section>
  );
}
