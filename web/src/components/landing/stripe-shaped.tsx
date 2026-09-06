/**
 * `StripeShaped` — the five things a merchant expects from a billing
 * platform, each stated as what Elapse ships. Set on the plate (`--plate`,
 * `--plate-ink`): on light paper the close inverts to an ink ground; in the
 * dark it is a raised near-black panel, never a white band (2026-09-06).
 */
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { links } from "@/lib/site";
import { cn } from "@/lib/utils";

const items = [
  ["TypeScript SDK", "Products, checkout sessions, subscriptions, customers, invoices. Secret key server-side only."],
  ["Hosted checkout", "Face ID sign-in, live counter, Cancel. Redirects to your success URL with a session id."],
  ["Signed webhooks", "X-Elapse-Signature with a timestamp and HMAC. Retried, deduplicated, replayable from the dashboard."],
  ["Test and live mode", "Separate keys, separate data. Break things in test; nothing moves until you flip live."],
  ["Dashboard", "Keys, products, running meters, delivery log with resend, payout address. Nothing you need SQL for."],
] as const;

export function StripeShaped() {
  return (
    <section className="plate">
      <div className="mx-auto max-w-[1280px] px-5 py-16 md:px-8 md:py-20">
        <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
          <div className="flex flex-col gap-6">
            <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
              Stripe&rsquo;s shape. A stopwatch&rsquo;s granularity.
            </h2>
            <p className="max-w-[44ch] text-pretty text-lg text-plate-ink/70">
              Merchants learn nothing new. The only novelty is that the meter is
              honest.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href={links.docs}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 border-transparent bg-plate-ink px-5 text-[15px] text-plate hover:bg-plate-ink/90",
                )}
              >
                Read the quickstart
                <ArrowRight data-icon="inline-end" className="size-4" />
              </a>
              <a
                href={links.github}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 border-plate-ink/30 bg-transparent px-5 text-[15px] text-plate-ink hover:bg-plate-ink/10 hover:text-plate-ink",
                )}
              >
                View on GitHub
              </a>
            </div>
          </div>
          <dl className="divide-y divide-plate-ink/15 border-y border-plate-ink/15">
            {items.map(([term, def]) => (
              <div key={term} className="grid gap-1 py-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
                <dt className="text-lg font-semibold leading-tight tracking-[-0.01em]">
                  {term}
                </dt>
                <dd className="max-w-[56ch] text-pretty text-plate-ink/70">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
