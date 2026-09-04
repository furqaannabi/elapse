/**
 * `BalancePage` — `/dashboard/balance`.
 *
 * Header: AUSD at the merchant's own payout address (never an "Elapse
 * balance"), the shortened address with copy and explorer link, settled
 * this month net. "Withdraw to bank" opens a sheet that states what a
 * merchant can do today; there is no integration behind it for 13 Oct.
 * Then the append-only ledger: deposit, settlement, fee, refund rows with
 * filters, per-kind totals, CSV, and reversed rows kept and marked.
 *
 * Maps to: FR-DSH-120…125; BR-DSH-005, BR-DSH-011, BR-DSH-012, BR-DSH-013.
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowUpRight, Download, ExternalLink, Landmark } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/site/copy-button";
import { EXPLORER, txUrl } from "@/lib/dashboard/chain";
import { shortHex, when } from "@/lib/dashboard/format";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { useMode } from "@/lib/dashboard/mode";
import type { LedgerEntry, LedgerKind } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { formatUsd, parseRate } from "@/lib/meter/math";
import { links } from "@/lib/site";
import { cn } from "@/lib/utils";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { ShowMore } from "./show-more";
import { StatusChip } from "./status-chip";

const usd = (v: string) => parseRate(v.replace(/,/g, ""));
const KINDS: { value: LedgerKind; word: string; plural: string; sign: "+" | "−" | "" }[] = [
  { value: "deposit", word: "Deposit", plural: "Deposits", sign: "" },
  { value: "settlement", word: "Settlement", plural: "Settlements", sign: "+" },
  { value: "fee", word: "Fee", plural: "Fees", sign: "−" },
  { value: "refund", word: "Refund", plural: "Refunds", sign: "" },
];
const PAGE = 50;

export function ledgerCsv(rows: LedgerEntry[]): string {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = "block_time,entry,kind,amount_usd,subscription,customer,tx,invoice,reversed_by";
  const body = rows.map((l) => [new Date(l.blockTime).toISOString(), l.id, l.kind, l.amountUsd, l.subscription, l.customer.email ?? l.customer.id, l.txId, l.invoice, l.reversedBy].map(esc).join(","));
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

export function BalancePage() {
  const { api } = useMerchant();
  const mode = useMode();
  const [kind, setKind] = useState<LedgerKind | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [withdraw, setWithdraw] = useState(false);
  const fetcher = useCallback(
    async () => ({
      balance: await api.getBalance(mode),
      ledger: await api.listLedger(mode, {
        kind: kind || undefined,
        since: from ? new Date(from).getTime() : undefined,
        until: to ? new Date(to).getTime() + 86_399_999 : undefined,
      }),
    }),
    [api, mode, kind, from, to],
  );
  const { data, loading, stale } = usePoll(fetcher);
  const paged = useShowMore(data?.ledger, PAGE);
  const input = "numerals h-9 rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  const totals = data
    ? KINDS.map((k) => ({ ...k, total: data.ledger.filter((l) => l.kind === k.value && !l.reversedBy).reduce((a, l) => a + usd(l.amountUsd), 0n) }))
    : null;

  return (
    <Page>
      <PageHeader
        title="Balance & payouts"
        lede={stale ? "Reconnecting…" : "Settled funds arrive at your payout address automatically. Elapse never holds your balance."}
        actions={
          <Button onClick={() => setWithdraw(true)} className="h-9" disabled={!data?.balance.payoutAddress}>
            <Landmark data-icon="inline-start" className="size-4" />
            Withdraw to bank
          </Button>
        }
      />

      {loading || !data ? (
        <Skeleton className="mt-6 h-28 w-full" />
      ) : !data.balance.payoutAddress ? (
        <div className="mt-6 rounded-lg border border-border px-5 py-8 text-center">
          <p className="text-[15px]">No payout address yet.</p>
          <p className="mt-1 text-[13px] text-ink-soft">Settlements need somewhere to land. Set it once; every meter pays there.</p>
          <Link href="/dashboard/settings" className={cn(buttonVariants({ variant: "outline" }), "mt-4 h-9")}>
            Set it in Settings
            <ArrowUpRight data-icon="inline-end" className="size-3.5" />
          </Link>
        </div>
      ) : (
        <dl className="mt-6 grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
          <div className="flex min-w-0 flex-col-reverse justify-end gap-2 px-5 py-4">
            <dt className="placard">At your payout address</dt>
            <dd className="numerals text-[1.75rem] leading-none">${data.balance.ausdUsd}</dd>
          </div>
          <div className="flex min-w-0 flex-col-reverse justify-end gap-2 px-5 py-4">
            <dt className="placard">Payout address</dt>
            <dd className="numerals flex items-center gap-1 text-[15px]">
              {shortHex(data.balance.payoutAddress)}
              <CopyButton text={data.balance.payoutAddress} label="Copy payout address" className="size-7" />
              <a href={`${mode === "live" ? EXPLORER.live : EXPLORER.test}/address/${data.balance.payoutAddress}`} target="_blank" rel="noreferrer" aria-label="View address on explorer" className="text-ink-soft hover:text-foreground">
                <ExternalLink className="size-3.5" />
              </a>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col-reverse justify-end gap-2 px-5 py-4">
            <dt className="placard">Settled this month, net</dt>
            <dd className="numerals text-[15px]">${data.balance.settledThisMonthNetUsd}</dd>
          </div>
        </dl>
      )}

      <section className="mt-10">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Ledger</h2>
            <p className="mt-1 text-[13px] text-ink-soft">Every movement of money, from the chain, in order. Nothing here can be edited or removed.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
              Kind
              <select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as LedgerKind | "")} className={input}>
                <option value="">All</option>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.plural}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
              From
              <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
              To
              <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
            </label>
            <Button variant="outline" disabled={!data || data.ledger.length === 0} onClick={() => data && download(`elapse-ledger-${mode}.csv`, ledgerCsv(data.ledger))} className="h-9">
              <Download data-icon="inline-start" className="size-4" />
              CSV
            </Button>
          </div>
        </div>

        {loading || !data || !totals ? (
          <Skeleton className="mt-4 h-64 w-full" />
        ) : (
          <>
            <section aria-label="Totals" className="mt-4 grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border md:grid-cols-4 md:divide-y-0">
              {totals.map((t) => (
                <div key={t.value} className="flex min-w-0 flex-col-reverse justify-end gap-1 px-4 py-3">
                  <dt className="placard">{t.plural}</dt>
                  <dd className="numerals text-[15px]">
                    {t.sign}
                    {formatUsd(t.total, 3)}
                  </dd>
                </div>
              ))}
            </section>
            {data.ledger.length === 0 ? (
              <p className="mt-4 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">No movements match.</p>
            ) : (
              <ol aria-label="Ledger" className="mt-4 divide-y divide-border rounded-lg border border-border">
                <li aria-hidden className="hidden grid-cols-[9rem_8.5rem_minmax(0,1fr)_7rem_7rem] gap-3 bg-muted/60 px-4 py-2.5 md:grid">
                  <span className="placard">Block time</span>
                  <span className="placard">Kind</span>
                  <span className="placard">Subscription · customer</span>
                  <span className="placard text-right">Amount</span>
                  <span className="placard text-right">Transaction</span>
                </li>
                {paged.visible.map((l) => {
                  const k = KINDS.find((x) => x.value === l.kind)!;
                  return (
                    <li key={l.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-[13px] md:grid-cols-[9rem_8.5rem_minmax(0,1fr)_7rem_7rem] md:items-center", l.reversedBy && "text-ink-soft")}>
                      <span className="numerals text-ink-soft">{when(l.blockTime)}</span>
                      <span className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                        <StatusChip tone={l.kind === "fee" ? "muted" : "neutral"}>{k.word}</StatusChip>
                        {l.reversedBy && <StatusChip tone="caution">Reversed</StatusChip>}
                      </span>
                      <span className="numerals col-span-2 min-w-0 truncate md:col-auto">
                        <Link href={`/dashboard/subscriptions/${l.subscription}`} className="hover:underline">
                          {l.subscription}
                        </Link>
                        <span className="text-ink-soft"> · {l.customer.email ?? l.customer.id}</span>
                        <span className="ml-2 text-[11px] text-ink-soft">{l.id}</span>
                      </span>
                      <span className={cn("numerals md:text-right", l.reversedBy && "line-through decoration-border")}>
                        {k.sign}${l.amountUsd}
                      </span>
                      <a href={txUrl(l.txId, l.livemode)} target="_blank" rel="noreferrer" aria-label={`View on explorer: ${l.txId}`} className="numerals inline-flex items-center gap-1 text-[12px] text-ink-soft hover:text-foreground md:justify-end">
                        {shortHex(l.txId)}
                        <ExternalLink className="size-3" />
                      </a>
                    </li>
                  );
                })}
              </ol>
            )}
            <ShowMore remaining={paged.remaining} onMore={paged.more} step={PAGE} />
          </>
        )}
      </section>

      <Sheet open={withdraw} onOpenChange={setWithdraw}>
        <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4 pr-14">
            <SheetTitle>Withdraw to bank</SheetTitle>
            <SheetDescription>The funds are already yours. Here is how to turn AUSD into money in a bank account today.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-5 py-5 text-[14px]">
            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="numerals w-5 shrink-0 text-ink-soft">1</span>
                <span>
                  Settlements pay AUSD to your payout address on Monad as they happen. You can check any of them on the explorer from the ledger below.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="numerals w-5 shrink-0 text-ink-soft">2</span>
                <span>
                  Move AUSD from that address to an exchange or off-ramp that supports Monad and AUSD, then sell for dollars and withdraw to your bank. The docs keep a current list of providers and their fees.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="numerals w-5 shrink-0 text-ink-soft">3</span>
                <span>Keep the ledger CSV for your books: every row is a real transaction with a hash.</span>
              </li>
            </ol>
            <a href={`${links.docs}/payouts`} target="_blank" rel="noreferrer" className={cn(buttonVariants(), "h-10 w-full")}>
              How to cash out
              <ArrowUpRight data-icon="inline-end" className="size-4" />
            </a>
            <p className="text-[12px] text-ink-soft">
              A one-click bank withdrawal is on the roadmap after 13 October and will use the same payout address. Nothing changes for you when it lands.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
