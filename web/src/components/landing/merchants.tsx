/**
 * `Merchants` — who Elapse is built for, in the merchant's voice. Four
 * categories set as a ledger, not cards: the term names the business, the
 * first line says what they sell and how they bill today, the second what
 * changes when a second is the unit, and a numerals column carries the
 * illustrative per-second rate with the per-hour figure derived by the real
 * meter math. Categories only; there are no customers to show, and none are
 * invented (BR-LND-002).
 *
 * Maps to: FR-LND-016 (folds in FR-LND-009).
 */
import { formatUsd, parseRate, perHour } from "@/lib/meter/math";

const categories = [
  {
    name: "GPU and inference clouds",
    today: "Rent accelerators and sell model calls, billed by the hour or by prepaid credits that expire.",
    change: "A training run or a chat session pays for exactly the seconds it held the card.",
    rate: "0.004",
  },
  {
    name: "Metered APIs",
    today: "Charge per request or per token, then reconcile usage into an invoice at month end.",
    change: "The meter runs while the connection is open, and the invoice is already settled when it closes.",
    rate: "0.0009",
  },
  {
    name: "Live streaming and events",
    today: "Sell a ticket for the whole show, and a viewer who leaves after ten minutes paid for two hours.",
    change: "A viewer pays for the minutes they watched and can leave without asking for a refund.",
    rate: "0.0011",
  },
  {
    name: "SaaS seats",
    today: "Bill a seat for a month whether the person logged in on two days or twenty.",
    change: "A seat costs nothing on holiday, and a team adds people without a proration email.",
    rate: "0.00003",
  },
] as const;

export function Merchants() {
  return (
    <section id="merchants" className="scroll-mt-14 border-y border-border">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-16 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:px-8 md:py-20">
        <div className="flex flex-col gap-5">
          <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
            Built for anything that runs while someone uses it.
          </h2>
          <p className="max-w-[44ch] text-pretty text-lg text-ink-soft">
            If your cost is a running thing and your price is a month, the gap
            is your churn. Set one rate per second and the price still reads
            like a price: Elapse shows the per-minute and per-hour figure
            beside it.
          </p>
          <span className="placard">Illustrative rates</span>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {categories.map(({ name, today, change, rate }) => {
            const nano = parseRate(rate);
            return (
              <div
                key={name}
                className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 py-6 md:grid-cols-[minmax(0,1fr)_9.5rem]"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <dt className="text-lg font-semibold leading-tight tracking-[-0.01em]">{name}</dt>
                  <dd className="max-w-[56ch] text-pretty text-ink-soft">{today}</dd>
                  <dd className="max-w-[56ch] text-pretty">{change}</dd>
                </div>
                <dd className="numerals flex flex-row items-baseline gap-x-3 whitespace-nowrap text-[15px] md:flex-col md:items-end md:gap-y-1 md:text-right">
                  <span>
                    ${rate}
                    <span className="text-ink-soft"> /s</span>
                  </span>
                  <span className="text-ink-soft">≈ {formatUsd(perHour(nano))} /h</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
