/**
 * `Hero` — the landing's first viewport and its focal moment.
 *
 * Left: the headline, one paragraph, two actions. Right: an instrument
 * panel — readout, Cancel, and the chart strip in one card — so the meter
 * reads as a device rather than numbers floating on a page. The demo
 * starts on its own shortly after load; Cancel lifts the pen, locks the
 * readout, and swaps the webhook card below to the visitor's numbers.
 *
 * On phones the panel sits directly under the headline so the meter is in
 * the first viewport.
 *
 * Maps to: FR-LND-001…005; design brief §1.1, §1.5.
 */
"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, Copy, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChartStrip, type Session } from "@/components/meter/chart-strip";
import { Readout } from "@/components/meter/readout";
import { formatUsd, wholeSeconds } from "@/lib/meter/math";
import { useMeter } from "@/lib/meter/use-meter";
import { demoProduct, links } from "@/lib/site";
import { cn } from "@/lib/utils";
import { WebhookCard } from "./webhook-card";

const INSTALL = "npm install @elapse/sdk";
const AUTO_START_MS = 900;
/** Below one cent the receipt shows three decimals so the number is real. */
const ONE_CENT_NANO = 10_000_000n;
const EXAMPLE = { seconds: 83, settled: "0.33", createdAt: 1_756_800_083 };

const arrive = { type: "tween", ease: [0.16, 1, 0.3, 1], duration: 0.6 } as const;

export function Hero() {
  const reduced = useReducedMotion();
  const [sessions, setSessions] = useState<Session[]>([]);
  const current = sessions.at(-1);
  const startedAt = current?.start ?? null;
  const pausedAt = current?.end ?? null;

  const meter = useMeter({ rate: demoProduct.rate, startedAt, pausedAt });
  const locked = Boolean(startedAt && pausedAt);

  const start = useCallback(() => {
    setSessions((s) => [...s, { start: Date.now(), end: null }]);
  }, []);

  const cancel = useCallback(() => {
    setSessions((s) => {
      const last = s.at(-1);
      if (!last || last.end !== null) return s;
      return [...s.slice(0, -1), { ...last, end: Date.now() }];
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(start, AUTO_START_MS);
    return () => clearTimeout(t);
  }, [start]);

  const seconds = wholeSeconds(meter.elapsedMs);
  const settledNano = meter.rateNano * BigInt(seconds);
  const settled = formatUsd(
    settledNano,
    settledNano > 0n && settledNano < ONE_CENT_NANO ? 3 : 2,
    { symbol: false },
  );

  return (
    <section className="relative">
      <div className="mx-auto max-w-[1280px] px-5 pt-10 md:px-8 md:pt-16">
        <div className="grid gap-8 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] md:grid-rows-[auto_auto] md:items-center md:gap-x-12 md:gap-y-6">
          <div className="order-1 md:order-none md:col-start-1 md:row-start-1">
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={arrive}
              className="display-wide text-balance text-[clamp(2.75rem,6.4vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.035em]"
            >
              You only pay what&nbsp;elapsed.
            </motion.h1>
          </div>

          <div className="order-3 flex flex-col gap-6 md:order-none md:col-start-1 md:row-start-2">
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...arrive, delay: 0.08 }}
              className="max-w-[42ch] text-pretty text-lg leading-snug text-ink-soft md:text-xl"
            >
              Per-second subscriptions for APIs, GPUs, streams and SaaS. A
              Stripe-shaped SDK, a hosted checkout, and signed webhooks. Your
              server hears about it once, by webhook.
            </motion.p>
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...arrive, delay: 0.16 }}
              className="flex flex-wrap items-center gap-3"
            >
              <a
                href={links.docs}
                className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-[15px]")}
              >
                Read the docs
                <ArrowRight data-icon="inline-end" className="size-4" />
              </a>
              <a
                href={links.dashboard}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 px-5 text-[15px]",
                )}
              >
                Open dashboard
              </a>
            </motion.div>
          </div>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...arrive, delay: 0.12 }}
            className="order-2 overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] md:order-none md:col-start-2 md:row-span-2 md:self-center"
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
              <span className="placard whitespace-nowrap">
                {demoProduct.merchant} · {demoProduct.name}
              </span>
              <span className="numerals whitespace-nowrap text-xs text-ink-soft">
                ${demoProduct.rate}/s<span className="hidden sm:inline"> · demo</span>
              </span>
            </div>
            <div className="flex flex-col gap-5 px-5 pb-5 pt-6 md:px-6">
              <Readout
                elapsed={meter.elapsed}
                accrued={meter.accruedLive}
                running={meter.running}
                size="panel"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-soft">
                  {locked
                    ? `Stopped · you paid ${seconds} s`
                    : meter.running
                      ? "Running · cancel any time"
                      : "Starting…"}
                </span>
                {locked ? (
                  <Button variant="outline" size="lg" onClick={start} className="h-11 px-4">
                    <RotateCcw data-icon="inline-start" className="size-4" />
                    Start again
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={cancel}
                    disabled={!meter.running}
                    className="h-11 px-6 text-[15px] font-medium"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
            <div className="border-t border-border bg-paper/40">
              <ChartStrip sessions={sessions} height={112} level={0.58} />
            </div>
          </motion.div>
        </div>

        <InstallRow />
      </div>

      <ProofRail />

      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <div className="grid gap-8 border-b border-border py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
          <div className="flex flex-col gap-3">
            <motion.p
              key={locked ? `locked-${startedAt}` : "resting"}
              initial={reduced ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={arrive}
              className="display-wide text-balance text-3xl font-semibold leading-tight tracking-[-0.025em] md:text-4xl"
            >
              {locked ? (
                <>
                  You paid{" "}
                  <span className="whitespace-nowrap">
                    {seconds} {seconds === 1 ? "second" : "seconds"}
                  </span>{" "}
                  <span className="whitespace-nowrap">
                    · <span className="numerals">${settled}</span>
                  </span>
                </>
              ) : (
                <>
                  Cancel at 83 seconds. Pay{" "}
                  <span className="whitespace-nowrap">83 seconds.</span>
                </>
              )}
            </motion.p>
            <p className="max-w-[40ch] text-pretty text-ink-soft">
              {locked
                ? "The pen lifted the moment you pressed Cancel. Unused funds go back. Your server found out by webhook, not a cron job."
                : "Press Cancel on the meter above. The pen lifts, the readout locks, and this event arrives at your server with those exact numbers."}
            </p>
          </div>
          <motion.div
            key={locked ? `card-${startedAt}` : "card-resting"}
            initial={reduced ? false : { opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={arrive}
          >
            <WebhookCard
              demo={!locked}
              secondsElapsed={locked ? seconds : EXAMPLE.seconds}
              amountSettled={locked ? settled : EXAMPLE.settled}
              createdAt={
                locked ? Math.floor((pausedAt ?? startedAt ?? 0) / 1000) : EXAMPLE.createdAt
              }
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/** Three true numbers that frame the product, set as one dense band. */
function ProofRail() {
  const items = [
    ["1 s", "billing granularity"],
    ["6", "lifecycle webhooks, never one per second"],
    ["0", "wallets your customer ever sees"],
  ] as const;
  return (
    <div className="border-y border-border bg-card/60">
      <dl className="mx-auto grid max-w-[1280px] grid-cols-1 divide-y divide-border px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 md:px-8">
        {items.map(([n, label]) => (
          <div key={label} className="flex items-baseline gap-3 py-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
            <dt className="numerals text-2xl text-live">{n}</dt>
            <dd className="text-sm text-ink-soft">{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The install placard: the whole row is the copy control. */
function InstallRow() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(INSTALL);
          setCopied(true);
        } catch {}
      }}
      aria-label={copied ? "Copied install command" : "Copy install command"}
      className="group mt-8 flex w-full items-center gap-3 py-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:mt-10"
    >
      <span className="placard shrink-0">Install</span>
      <code className="numerals min-w-0 truncate text-[15px] md:text-base">
        <span className="text-ink-soft">$ </span>
        {INSTALL}
      </code>
      <span
        className={cn(
          "ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors group-hover:bg-muted group-hover:text-foreground",
          copied && "text-live group-hover:text-live",
        )}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </span>
    </button>
  );
}
