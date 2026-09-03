/**
 * `Tariff` — use cases as a rate card. Each row is a thing that should
 * bill by the second, with its per-second rate and the derived per-hour
 * figure computed by the real meter math. Rates are illustrative and
 * labelled as such.
 */
import { formatUsd, parseRate, perHour } from "@/lib/meter/math";

const rows = [
  ["GPU rental", "An RTX 4090 by the second, not the hour", "0.004"],
  ["API metering", "A vision model billed per request-second", "0.0009"],
  ["Live streaming", "A pay-per-view stream you can leave", "0.0011"],
  ["SaaS seats", "A seat that costs nothing on holiday", "0.00003"],
  ["Desk & studio time", "A recording room, a hot desk, a court", "0.0083"],
] as const;

export function Tariff() {
  return (
    <section className="border-y border-border">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-16 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:px-8 md:py-20">
        <div className="flex flex-col gap-5">
          <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
            Anything that runs while someone uses it.
          </h2>
          <p className="max-w-[44ch] text-pretty text-lg text-ink-soft">
            Set one rate per second. Elapse shows your customer the per-minute
            and per-hour figures so the price still reads like a price.
          </p>
          <span className="placard">Illustrative rates</span>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {rows.map(([name, blurb, rate]) => {
            const nano = parseRate(rate);
            return (
              <div
                key={name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 py-5 md:grid-cols-[minmax(0,1fr)_8rem_8.5rem] md:items-baseline"
              >
                <div className="flex flex-col gap-1">
                  <dt className="text-lg font-semibold leading-tight tracking-[-0.01em]">
                    {name}
                  </dt>
                  <dd className="text-ink-soft">{blurb}</dd>
                </div>
                <div className="contents md:hidden">
                  <dd className="numerals flex flex-col items-end gap-1 whitespace-nowrap text-right text-[15px]">
                    <span>
                      ${rate}
                      <span className="text-ink-soft"> /s</span>
                    </span>
                    <span className="text-ink-soft">≈ {formatUsd(perHour(nano))} /h</span>
                  </dd>
                </div>
                <dd className="numerals hidden whitespace-nowrap text-right text-[15px] md:block">
                  ${rate}
                  <span className="text-ink-soft"> /s</span>
                </dd>
                <dd className="numerals hidden whitespace-nowrap text-right text-[15px] text-ink-soft md:block">
                  ≈ {formatUsd(perHour(nano))} /h
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
