/**
 * `InvoicesPage` — `/dashboard/invoices`: every `settle()` pull as a row
 * with gross, fee, net, and a short tx id linking to the explorer; date
 * range and subscription filters; a totals row; CSV export.
 *
 * Maps to: FR-DSH-060, FR-DSH-061, FR-DSH-062; BR-DSH-005, BR-DSH-009.
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { txUrl } from "@/lib/dashboard/chain";
import { shortHex, when } from "@/lib/dashboard/format";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { useMode } from "@/lib/dashboard/mode";
import type { Invoice } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { formatUsd, parseRate } from "@/lib/meter/math";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { ShowMore } from "./show-more";

const usd = (v: string) => parseRate(v.replace(/,/g, ""));
const PAGE = 50;

export function invoicesCsv(rows: Invoice[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = "settled_at,invoice,subscription,customer,seconds,gross_usd,fee_usd,net_usd,tx";
  const body = rows.map((i) =>
    [new Date(i.settledAt).toISOString(), i.id, i.subscription, i.customer.email ?? i.customer.id, i.seconds, i.grossUsd, i.feeUsd, i.netUsd, i.txId].map(esc).join(","),
  );
  return [head, ...body].join("\n") + "\n";
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function InvoicesPage() {
  const { api, merchant } = useMerchant();
  const mode = useMode();
  const [subscription, setSubscription] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fetcher = useCallback(
    () =>
      api.listInvoices(mode, {
        subscription: subscription.trim() || undefined,
        since: from ? new Date(from).getTime() : undefined,
        until: to ? new Date(to).getTime() + 86_399_999 : undefined,
      }),
    [api, mode, subscription, from, to],
  );
  const { data, loading, stale } = usePoll(fetcher);
  const paged = useShowMore(data, PAGE);

  const totals = data
    ? data.reduce(
        (t, i) => ({ seconds: t.seconds + i.seconds, gross: t.gross + usd(i.grossUsd), fee: t.fee + usd(i.feeUsd), net: t.net + usd(i.netUsd) }),
        { seconds: 0, gross: 0n, fee: 0n, net: 0n },
      )
    : null;
  const feePct = (merchant.feeBps / 100).toString();
  const input = "numerals h-9 rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  return (
    <Page>
      <PageHeader
        title="Invoices"
        lede={
          stale ? (
            "Reconnecting…"
          ) : (
            <>
              Settled funds go straight to your payout address. Elapse keeps {feePct} %.{" "}
              <Link href="/dashboard/balance" className="text-foreground underline-offset-4 hover:underline">
                Balance &amp; payouts
              </Link>
            </>
          )
        }
        actions={
          <Button variant="outline" disabled={!data || data.length === 0} onClick={() => data && download(`elapse-invoices-${mode}.csv`, invoicesCsv(data))} className="h-9">
            <Download data-icon="inline-start" className="size-4" />
            Export CSV
          </Button>
        }
      />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          Subscription id
          <input aria-label="Subscription id" value={subscription} onChange={(e) => setSubscription(e.target.value)} placeholder="sub_…" className={input + " w-44"} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          From
          <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          To
          <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
      </div>

      {loading || !data || !totals ? (
        <Skeleton className="mt-4 h-64 w-full" />
      ) : data.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">
          {subscription || from || to ? "No settlements match." : "Nothing settled yet. Settlements appear a few minutes after a meter starts."}
        </p>
      ) : (
        <>
          <ol aria-label="Invoices" className="mt-4 divide-y divide-border rounded-lg border border-border">
            <li aria-hidden className="hidden grid-cols-[9rem_minmax(0,1fr)_5rem_6rem_6rem_6rem_7rem] gap-3 bg-muted/60 px-4 py-2.5 md:grid">
              <span className="placard">Settled</span>
              <span className="placard">Subscription · customer</span>
              <span className="placard text-right">Seconds</span>
              <span className="placard text-right">Gross</span>
              <span className="placard text-right">Fee</span>
              <span className="placard text-right">Net</span>
              <span className="placard text-right">Settlement</span>
            </li>
            {paged.visible.map((i) => (
              <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 text-[13px] md:grid-cols-[9rem_minmax(0,1fr)_5rem_6rem_6rem_6rem_7rem] md:items-center md:gap-3">
                <span className="numerals col-span-2 text-ink-soft md:col-auto">{when(i.settledAt)}</span>
                <span className="numerals col-span-2 min-w-0 truncate md:col-auto">
                  <Link href={`/dashboard/subscriptions/${i.subscription}`} className="hover:underline">
                    {i.subscription}
                  </Link>
                  <span className="text-ink-soft"> · {i.customer.email ?? i.customer.id}</span>
                </span>
                <span className="numerals text-ink-soft md:text-right">
                  <span className="placard mr-1.5 md:hidden">Seconds</span>
                  {i.seconds}
                </span>
                <span className="numerals md:text-right">
                  <span className="placard mr-1.5 md:hidden">Gross</span>${i.grossUsd}
                </span>
                <span className="numerals text-ink-soft md:text-right">
                  <span className="placard mr-1.5 md:hidden">Fee</span>−${i.feeUsd}
                </span>
                <span className="numerals md:text-right">
                  <span className="placard mr-1.5 md:hidden">Net</span>${i.netUsd}
                </span>
                <a href={txUrl(i.txId, i.livemode)} target="_blank" rel="noreferrer" aria-label={`View on explorer: ${i.txId}`} className="numerals col-span-2 inline-flex items-center gap-1 text-[12px] text-ink-soft hover:text-foreground md:col-auto md:justify-end">
                  {shortHex(i.txId)}
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ol>
          <div role="row" aria-label="Totals" className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-[13px] md:grid-cols-[9rem_minmax(0,1fr)_5rem_6rem_6rem_6rem_7rem] md:gap-3">
            <span className="placard self-center">Totals</span>
            <span className="text-ink-soft md:col-auto">
              <span className="numerals">{data.length}</span> {data.length === 1 ? "settlement" : "settlements"}
            </span>
            <span className="numerals text-ink-soft md:text-right">
              <span className="placard mr-1 md:hidden">Seconds</span>
              {totals.seconds}
            </span>
            <span className="numerals md:text-right">
              <span className="placard mr-1 md:hidden">Gross</span>
              {formatUsd(totals.gross, 3)}
            </span>
            <span className="numerals text-ink-soft md:text-right">
              <span className="placard mr-1 md:hidden">Fee</span>−{formatUsd(totals.fee, 3)}
            </span>
            <span className="numerals md:text-right">
              <span className="placard mr-1 md:hidden">Net</span>
              {formatUsd(totals.net, 3)}
            </span>
            <span />
          </div>
          <ShowMore remaining={paged.remaining} onMore={paged.more} step={PAGE} />
        </>
      )}
    </Page>
  );
}
