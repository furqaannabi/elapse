/**
 * `CustomerDetail` — right pane: the customer's subscriptions (status,
 * accrued or settled) and their events. No wallet address anywhere
 * (BR-DSH-005).
 *
 * Maps to: FR-DSH-051.
 */
"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/site/copy-button";
import { when } from "@/lib/dashboard/format";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import { usePoll } from "@/lib/dashboard/use-poll";
import { LiveAmount } from "./live-amount";
import { useMerchant } from "./merchant-context";
import { StatusChip } from "./status-chip";
import { SUB_TONE, subWord } from "./subscriptions-list";

export function CustomerDetail({ customerId }: { customerId: string }) {
  const { api } = useMerchant();
  const fetcher = useCallback(() => api.getCustomer(customerId), [api, customerId]);
  const { data, loading, error } = usePoll(fetcher);

  if (error instanceof DashboardApiError && error.code === "not_found") {
    return (
      <div className="px-5 py-6 md:px-8">
        <p className="text-[15px]">We can&apos;t find this customer.</p>
        <p className="mt-1 text-[13px] text-ink-soft">It may belong to the other mode. Switch Test / Live and try again.</p>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="px-5 py-6 md:px-8" aria-busy>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }
  const { customer: c, subscriptions, events } = data;
  return (
    <div className="px-5 py-6 md:px-8">
      <h2 className={"text-[1.125rem] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] " + (c.email ? "numerals" : "")}>{c.email ?? c.id}</h2>
      <p className="numerals mt-1 flex items-center gap-1 text-[12px] text-ink-soft">
        {c.id}
        <CopyButton text={c.id} label="Copy customer id" className="size-7" />
        <span className="ml-2">joined {when(c.createdAt)}</span>
      </p>
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border overflow-hidden rounded-lg border border-border">
        <div className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
          <dt className="placard">Total settled</dt>
          <dd className="numerals text-[15px]">${c.totalSettledUsd}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
          <dt className="placard">Subscriptions</dt>
          <dd className="numerals text-[15px]">{c.subscriptionCount}</dd>
        </div>
      </dl>

      <section className="mt-8">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Subscriptions</h3>
        <ol aria-label="Subscriptions" className="mt-3 divide-y divide-border rounded-lg border border-border">
          {subscriptions.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-soft">None yet.</li>}
          {subscriptions.map((s) => (
            <li key={s.id}>
              <Link href={`/dashboard/subscriptions/${s.id}`} className="flex min-h-14 flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{s.product.name}</span>
                    <StatusChip tone={SUB_TONE[s.status]} className="h-5 px-1.5 text-[11px]">
                      {subWord(s.status)}
                    </StatusChip>
                  </span>
                  <span className="numerals block truncate text-[12px] text-ink-soft">{s.id}</span>
                </span>
                {s.status === "incomplete" ? <span className="text-[12px] text-ink-soft">Not started</span> : <LiveAmount subscription={s} className="shrink-0 self-end sm:self-auto" />}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Events</h3>
        <ol aria-label="Events" className="mt-3 divide-y divide-border rounded-lg border border-border">
          {events.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-soft">None yet.</li>}
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/dashboard/developers/events/${e.id}`} className="flex min-h-11 flex-col gap-0.5 px-4 py-2 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3">
                <span className="numerals min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">{e.type}</span>
                <span className="numerals shrink-0 text-[12px] text-ink-soft">{when(e.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
