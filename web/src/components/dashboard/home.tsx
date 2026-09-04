/**
 * `HomePage` — `/dashboard`.
 *
 * Until the merchant has a product, a secret key, a webhook endpoint, and
 * one succeeded delivery in the current mode, Home is the four-step
 * checklist. After that it is the overview: a stat strip, the meters
 * running right now (ticking), and the last ten events.
 *
 * Maps to: FR-DSH-020, FR-DSH-021, FR-DSH-022, FR-DSH-023, FR-DSH-007.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBlock } from "@/components/site/code-block";
import { timeAgo } from "@/lib/dashboard/format";
import { useMode } from "@/lib/dashboard/mode";
import type { ChecklistState, Event, Overview, Subscription } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { cn } from "@/lib/utils";
import { LiveAmount } from "./live-amount";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";

type HomeData = { checklist: ChecklistState; overview: Overview | null };

export function HomePage() {
  const { api, merchant } = useMerchant();
  const mode = useMode();

  const fetcher = useCallback(async (): Promise<HomeData> => {
    const checklist = await api.checklist(mode);
    const done = checklist.hasProduct && checklist.hasSecretKey && checklist.hasEndpoint && checklist.hasSucceededDelivery;
    return { checklist, overview: done ? await api.overview(mode) : null };
  }, [api, mode]);

  const { data, loading, stale } = usePoll(fetcher);

  if (loading || !data) {
    return (
      <Page>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-8 h-24 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </Page>
    );
  }

  if (!data.overview) {
    return (
      <Page>
        <Checklist state={data.checklist} merchantName={merchant.name ?? ""} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Home"
        lede={stale ? "Reconnecting…" : "What your meters are doing right now."}
      />
      <StatStrip overview={data.overview} />
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
        <RunningNow subscriptions={data.overview.running} total={data.overview.runningNow} />
        <RecentEvents events={data.overview.recentEvents} />
      </div>
    </Page>
  );
}

/* ---------- checklist ---------- */

const STEPS = [
  {
    key: "hasProduct",
    title: "Create a product",
    body: "Name it and set a rate per second. We show the per-minute and per-hour price beside it.",
    href: "/dashboard/products?new=1",
    action: "Create a product",
  },
  {
    key: "hasSecretKey",
    title: "Copy a test secret key",
    body: "Your server uses it to create checkout sessions. It is shown once.",
    href: "/dashboard/developers/keys",
    action: "Create a key",
  },
  {
    key: "hasEndpoint",
    title: "Add a webhook endpoint",
    body: "Where we POST subscription.created, subscription.canceled, and invoice.settled.",
    href: "/dashboard/developers/webhooks",
    action: "Add an endpoint",
  },
  {
    key: "hasSucceededDelivery",
    title: "Receive your first event",
    body: "Create a checkout session, open it, start the meter, cancel. Your endpoint gets the webhook.",
    href: "/dashboard/developers/events",
    action: "Watch events",
  },
] as const;

const SNIPPET = `import Elapse from "@elapse/sdk";
const elapse = new Elapse(process.env.ELAPSE_SECRET_KEY);

const session = await elapse.checkout.sessions.create({
  product: "prod_…",
  success_url: "https://your.app/thanks?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://your.app/pricing",
});
// send the subscriber to session.url`;

function Checklist({ state, merchantName }: { state: ChecklistState; merchantName: string }) {
  const done = STEPS.filter((s) => state[s.key]).length;
  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display-wide text-balance text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] md:text-[2rem]">
            Make your first meter tick.
          </h1>
          <p className="mt-2 max-w-[52ch] text-[15px] text-ink-soft">
            Four steps for {merchantName || "your business"}. Most merchants finish in an afternoon; the
            list disappears when the first webhook lands.
          </p>
        </div>
        <p className="numerals shrink-0 text-[13px] text-ink-soft">
          <span className="text-foreground">{done} of 4</span> done
        </p>
      </div>

      <ol aria-label="First steps" className="mt-8 divide-y divide-border rounded-lg border border-border">
        {STEPS.map((step, i) => {
          const isDone = state[step.key];
          return (
            <li key={step.key} className="flex gap-4 px-4 py-5 md:gap-6 md:px-6">
              <div className="w-8 shrink-0 pt-0.5">
                {isDone ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-foreground">
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="numerals text-[1.25rem] leading-none text-ink-soft">{i + 1}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className={cn("text-[1.0625rem] font-semibold tracking-[-0.01em]", isDone && "text-ink-soft line-through decoration-border")}>
                      {step.title}
                    </h2>
                    <p className="mt-1 max-w-[56ch] text-[14px] text-ink-soft">{step.body}</p>
                  </div>
                  {isDone ? (
                    <span className="placard shrink-0 pt-1">Done</span>
                  ) : (
                    <Link
                      href={step.href}
                      className={cn(buttonVariants({ variant: i === done ? "default" : "outline", size: "sm" }), "h-9 shrink-0 self-start px-3")}
                    >
                      {step.action}
                      <ArrowRight data-icon="inline-end" className="size-3.5" />
                    </Link>
                  )}
                </div>
                {step.key === "hasSucceededDelivery" && !isDone && (
                  <CodeBlock code={SNIPPET} title="server.ts" lang="ts" wrap className="mt-4" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- overview ---------- */

function StatStrip({ overview }: { overview: Overview }) {
  const cells = [
    { label: "Running now", value: String(overview.runningNow), unit: overview.runningNow === 1 ? "meter" : "meters", live: overview.runningNow > 0 },
    { label: "Accrued today", value: `$${overview.accruedTodayUsd}`, unit: "so far" },
    { label: "Settled this week", value: `$${overview.settledWeekNetUsd}`, unit: "net of fee" },
    { label: "Failed payments", value: String(overview.failedPaymentsWeek), unit: "this week" },
  ];
  return (
    <dl className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-y divide-border overflow-hidden rounded-lg border border-border md:grid-cols-[repeat(4,minmax(0,1fr))] md:divide-y-0">
      {cells.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col-reverse justify-end gap-2 px-4 py-4 md:px-5">
          <dt className="placard">{c.label}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={cn("numerals text-[1.5rem] leading-none md:text-[1.75rem]", c.live && "text-live")}>{c.value}</span>
            <span className="text-[12px] whitespace-nowrap text-ink-soft">{c.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RunningNow({ subscriptions, total }: { subscriptions: Subscription[]; total: number }) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Running now</h2>
        <Link href="/dashboard/subscriptions" className="text-[13px] text-ink-soft underline-offset-4 hover:text-foreground hover:underline">
          All subscriptions
        </Link>
      </div>
      {subscriptions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border px-4 py-8 text-center text-[14px] text-ink-soft">
          No meters running. Share a checkout link to start one.
        </p>
      ) : (
        <ol aria-label="Running now" className="mt-4 divide-y divide-border rounded-lg border border-border">
          {subscriptions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/dashboard/subscriptions/${s.id}`}
                className="flex min-h-14 flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{s.product.name}</p>
                  <p className="numerals truncate text-[12px] text-ink-soft">{s.customer.email ?? s.customer.id}</p>
                </div>
                <LiveAmount subscription={s} className="shrink-0 self-end sm:self-auto" />
              </Link>
            </li>
          ))}
          {total > subscriptions.length && (
            <li className="px-4 py-2.5 text-[13px] text-ink-soft">
              and <span className="numerals">{total - subscriptions.length}</span> more
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

const DELIVERY_WORD: Record<Event["deliveryState"], string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
};

function RecentEvents({ events }: { events: Event[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Recent events</h2>
        <Link href="/dashboard/developers/events" className="text-[13px] text-ink-soft underline-offset-4 hover:text-foreground hover:underline">
          All events
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border px-4 py-8 text-center text-[14px] text-ink-soft">
          No events yet.
        </p>
      ) : (
        <ol aria-label="Recent events" className="mt-4 divide-y divide-border rounded-lg border border-border">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/dashboard/developers/events/${e.id}`}
                className="flex min-h-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="numerals truncate text-[13px]">{e.type}</p>
                  <p className="numerals truncate text-[12px] text-ink-soft">{e.objectId}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[12px]",
                    e.deliveryState === "failed" ? "text-destructive" : e.deliveryState === "pending" ? "text-caution" : "text-ink-soft",
                  )}
                >
                  {DELIVERY_WORD[e.deliveryState]}
                </span>
                <span className="w-16 shrink-0 text-right text-[12px] text-ink-soft">{timeAgo(e.createdAt, now)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
