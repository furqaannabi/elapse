/**
 * `MeterVsMonth` — the problem, drawn: a monthly bill is a 30-cell strip
 * with three cells used and twenty-seven paid for; a per-second meter is
 * a strip with only the used span inked. Both are inline SVG in the
 * chart-paper grammar so the comparison is the same material.
 *
 * When the section scrolls into view the two strips draw themselves once:
 * the month fills its three used days, then the hatch spreads across the
 * unused twenty-seven; the second strip's pen comes down, runs 83 seconds,
 * and lifts. Reduced motion renders the final state.
 */
"use client";

import { motion, useReducedMotion } from "motion/react";

const ease = [0.16, 1, 0.3, 1] as const;

export function MeterVsMonth() {
  return (
    <section className="border-y border-border bg-card/60">
      <div className="mx-auto grid max-w-[1280px] gap-x-12 gap-y-6 px-5 py-16 md:grid-cols-2 md:grid-rows-[auto_auto] md:px-8 md:py-20">
        <div className="flex flex-col gap-6 md:col-start-1 md:row-start-1">
          <h2 className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-[2.5rem]">
            Cancel on day 3, pay for 30. The meter is a lie.
          </h2>
          <p className="max-w-[48ch] text-pretty text-lg text-ink-soft">
            Usage is continuous. Billing is not. Cards and slow settlement
            made anything finer than a month uneconomic, so APIs, GPUs and
            live streams round up or sell prepaid credits.
          </p>
        </div>
        <div className="md:col-start-1 md:row-start-2 md:self-end">
          <MonthStrip />
        </div>
        <p className="max-w-[48ch] text-pretty text-lg text-ink-soft md:col-start-2 md:row-start-1 md:self-end mt-6 md:mt-0">
          Elapse accrues every second and settles only what elapsed. Cancel
          mid-second and the unused funds are already yours. Your server
          hears about it once, by webhook.
        </p>
        <div className="md:col-start-2 md:row-start-2 md:self-end">
          <SecondStrip />
        </div>
      </div>
    </section>
  );
}

const viewport = { once: true, amount: 0.6 } as const;

function MonthStrip() {
  const reduced = useReducedMotion();
  const cells = Array.from({ length: 30 }, (_, i) => i);
  return (
    <figure className="flex flex-col gap-3">
      <motion.svg
        viewBox="0 0 600 64"
        className="w-full"
        role="img"
        aria-label="A 30-day bar: 3 days used, 27 days paid for but unused"
        initial={reduced ? "shown" : "hidden"}
        whileInView="shown"
        viewport={viewport}
      >
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-soft)" strokeWidth="1" strokeOpacity="0.45" />
          </pattern>
        </defs>
        {cells.map((i) => (
          <motion.rect
            key={i}
            x={i * 20 + 0.5}
            y={8.5}
            width={19}
            height={40}
            fill={i < 3 ? "var(--pen)" : "url(#hatch)"}
            stroke="var(--ink)"
            strokeOpacity={0.25}
            variants={{
              hidden: { fillOpacity: 0 },
              shown: {
                fillOpacity: 1,
                transition: { delay: i < 3 ? 0.1 + i * 0.12 : 0.55 + (i - 3) * 0.03, duration: 0.25, ease },
              },
            }}
          />
        ))}
        <text x="0" y="62" className="numerals" fontSize="10" fill="var(--ink-soft)">
          DAY 1
        </text>
        <text x="600" y="62" textAnchor="end" className="numerals" fontSize="10" fill="var(--ink-soft)">
          DAY 30
        </text>
      </motion.svg>
      <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="placard">Monthly plan · used 3 days</span>
        <span className="numerals text-sm">
          paid <span className="text-pen">$30.00</span>
        </span>
      </figcaption>
    </figure>
  );
}

function SecondStrip() {
  const reduced = useReducedMotion();
  return (
    <figure className="flex flex-col gap-3">
      <motion.svg
        viewBox="0 0 600 64"
        className="w-full"
        role="img"
        aria-label="A per-second strip: only the 83 seconds used are inked"
        initial={reduced ? "shown" : "hidden"}
        whileInView="shown"
        viewport={viewport}
      >
        <rect x="0.5" y="8.5" width="599" height="40" fill="none" stroke="var(--ink)" strokeOpacity="0.25" />
        {Array.from({ length: 29 }, (_, i) => (
          <line
            key={i}
            x1={(i + 1) * 20 + 0.5}
            y1="8.5"
            x2={(i + 1) * 20 + 0.5}
            y2="48.5"
            stroke="var(--ink)"
            strokeOpacity="0.08"
          />
        ))}
        <motion.rect
          x="0.5"
          y="8.5"
          height="40"
          fill="var(--pen-soft)"
          variants={{
            hidden: { width: 0 },
            shown: { width: 166, transition: { delay: 0.25, duration: 0.9, ease: "linear" } },
          }}
        />
        <motion.path
          d="M0.5 48.5 V 18.5 H 166.5 V 48.5"
          fill="none"
          stroke="var(--pen)"
          strokeWidth="2"
          variants={{
            hidden: { pathLength: 0 },
            shown: { pathLength: 1, transition: { delay: 0.1, duration: 1.2, ease: "linear" } },
          }}
        />
        <text x="0" y="62" className="numerals" fontSize="10" fill="var(--ink-soft)">
          0 s
        </text>
        <motion.text
          x="166"
          y="62"
          textAnchor="middle"
          className="numerals"
          fontSize="10"
          fill="var(--pen)"
          variants={{
            hidden: { opacity: 0 },
            shown: { opacity: 1, transition: { delay: 1.3, duration: 0.3 } },
          }}
        >
          83 s
        </motion.text>
        <text x="600" y="62" textAnchor="end" className="numerals" fontSize="10" fill="var(--ink-soft)">
          5 min
        </text>
      </motion.svg>
      <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="placard">Per-second meter · used 83 seconds</span>
        <span className="numerals text-sm">
          paid <span className="text-pen">$0.33</span>
        </span>
      </figcaption>
    </figure>
  );
}
