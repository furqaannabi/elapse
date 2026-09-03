/**
 * `RatePanel` — what is being bought and at what price, in the words a
 * subscriber uses: per second, and roughly per minute and per hour.
 *
 * Maps to: FR-CHK-001.
 */
import { formatUsd, parseRate, perHour, perMinute } from "@/lib/meter/math";
import type { Product } from "@/lib/checkout/types";

export function RatePanel({ product }: { product: Product }) {
  const rate = parseRate(product.rateUsdPerSecond);
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-5">
      <p className="placard">You are starting</p>
      <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.02em]">
        {product.name}
      </h1>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="numerals text-4xl text-live">${product.rateUsdPerSecond}</span>
        <span className="text-ink-soft">per second</span>
      </div>
      <p className="numerals mt-2 text-sm text-ink-soft">
        {formatUsd(perMinute(rate))} / minute · {formatUsd(perHour(rate))} / hour
      </p>
      <p className="mt-4 text-sm text-ink-soft">
        Billed by the second. Stop whenever you like; unused funds come back.
      </p>
    </section>
  );
}
