/**
 * `StateNotice` — the dead-end states: expired, already used, product
 * archived, network error, plus the loading skeleton. Each names the
 * problem and the way out; none blames the subscriber.
 *
 * Maps to: FR-CHK-010.
 */
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Branding } from "@/lib/checkout/types";
import { cn } from "@/lib/utils";

type Kind = "expired" | "used" | "archived" | "error" | "not_found";

const COPY: Record<Kind, { title: string; body: string }> = {
  expired: {
    title: "This link has expired.",
    body: "Checkout links are valid for a limited time. Go back and start again from where you came.",
  },
  used: {
    title: "This link has already been used.",
    body: "Each checkout link works once. Go back and request a new one.",
  },
  archived: {
    title: "This product is no longer available.",
    body: "The seller has retired it. Nothing has been charged.",
  },
  not_found: {
    title: "We can't find this checkout.",
    body: "Check the link, or go back and try again.",
  },
  error: {
    title: "Something went wrong on our side.",
    body: "Nothing has been charged. Try again in a moment.",
  },
};

export function StateNotice({
  kind,
  merchant,
  onRetry,
}: {
  kind: Kind;
  merchant?: Branding & { cancelUrl?: string };
  onRetry?: () => void;
}) {
  const c = COPY[kind];
  return (
    <section className="flex flex-1 flex-col justify-center gap-6 py-10">
      <div>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">
          {c.title}
        </h1>
        <p className="mt-3 max-w-[38ch] text-pretty text-ink-soft">{c.body}</p>
      </div>
      <div className="flex flex-col gap-2">
        {kind === "error" && onRetry && (
          <Button size="lg" onClick={onRetry} className="h-12 w-full text-base">
            <RotateCcw data-icon="inline-start" className="size-4" />
            Try again
          </Button>
        )}
        {merchant?.cancelUrl && (
          <a
            href={merchant.cancelUrl}
            className={cn(
              buttonVariants({ variant: kind === "error" ? "outline" : "default", size: "lg" }),
              "h-12 w-full text-base",
            )}
          >
            <ArrowLeft data-icon="inline-start" className="size-4" />
            Back to {merchant.name}
          </a>
        )}
      </div>
    </section>
  );
}

/** Loading skeleton with the same silhouette as the rate panel. */
export function CheckoutSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4" aria-busy aria-label="Loading checkout">
      <div className="rounded-xl border border-border bg-card px-5 py-5">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-5 h-10 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-3 w-48 animate-pulse rounded bg-muted" />
      </div>
      <div className="mt-auto h-12 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
