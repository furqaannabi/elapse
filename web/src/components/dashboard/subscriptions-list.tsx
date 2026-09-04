/**
 * `SubscriptionsList` — left pane of `/dashboard/subscriptions`: every
 * meter, newest first, status word, product, customer, and the amount
 * (ticking for active, frozen for paused, final for canceled). Filters by
 * status and product.
 *
 * Maps to: FR-DSH-040, FR-DSH-007.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMode } from "@/lib/dashboard/mode";
import type { Subscription } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { cn } from "@/lib/utils";
import { LiveAmount } from "./live-amount";
import { useMerchant } from "./merchant-context";
import { ShowMore } from "./show-more";
import { StatusChip, type ChipTone } from "./status-chip";

export const SUB_TONE: Record<Subscription["status"], ChipTone> = { incomplete: "muted", active: "live", paused: "caution", canceled: "muted" };
export const subWord = (s: Subscription["status"]) => s[0]!.toUpperCase() + s.slice(1);
const STATUSES: Subscription["status"][] = ["active", "paused", "canceled", "incomplete"];
const PAGE = 50;

export function SubscriptionsList() {
  const { api } = useMerchant();
  const mode = useMode();
  const pathname = usePathname();
  const [status, setStatus] = useState<Subscription["status"] | "">("");
  const [product, setProduct] = useState("");
  const fetcher = useCallback(
    async () => ({
      subscriptions: await api.listSubscriptions(mode, { status: status || undefined, product: product || undefined }),
      products: await api.listProducts(mode, { includeArchived: true }),
    }),
    [api, mode, status, product],
  );
  const { data, loading, stale } = usePoll(fetcher);
  const paged = useShowMore(data?.subscriptions, PAGE);

  const select = "h-9 max-w-[11rem] rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  return (
    <div className="px-5 py-6 md:px-6">
      <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]">Subscriptions</h1>
      <p className="mt-1 text-[14px] text-ink-soft">{stale ? "Reconnecting…" : "Every meter, running or not."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-ink-soft">
          Filter by status
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as Subscription["status"] | "")} className={select}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {subWord(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-ink-soft">
          Product
          <select aria-label="Filter by product" value={product} onChange={(e) => setProduct(e.target.value)} className={select}>
            <option value="">All</option>
            {data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading || !data ? (
        <Skeleton className="mt-5 h-72 w-full" />
      ) : data.subscriptions.length === 0 ? (
        <p className="mt-5 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">
          {status || product ? "No meters match." : "No meters yet. Share a checkout link to start one."}
        </p>
      ) : (
        <ol aria-label="Subscriptions" className="mt-5 divide-y divide-border rounded-lg border border-border">
          {paged.visible.map((s) => {
            const href = `/dashboard/subscriptions/${s.id}`;
            const current = pathname === href;
            return (
              <li key={s.id}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn("relative flex min-h-14 flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3", current && "bg-muted")}
                >
                  {current && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium">{s.product.name}</span>
                      <StatusChip tone={SUB_TONE[s.status]} className="h-5 px-1.5 text-[11px]">
                        {subWord(s.status)}
                      </StatusChip>
                    </span>
                    <span className="numerals block truncate text-[12px] text-ink-soft">
                      <span>{s.id}</span> · {s.customer.email ?? s.customer.id}
                    </span>
                  </span>
                  {s.status === "incomplete" ? (
                    <span className="text-[12px] text-ink-soft">Not started</span>
                  ) : (
                    <LiveAmount subscription={s} className="shrink-0 self-end sm:self-auto" />
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <ShowMore remaining={paged.remaining} onMore={paged.more} step={PAGE} />
    </div>
  );
}
