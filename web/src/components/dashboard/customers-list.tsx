/**
 * `CustomersList` — left pane of `/dashboard/customers`: email (or
 * "Passkey user"), subscriptions, total settled, created. Search by email
 * or id. The active row follows the route.
 *
 * Maps to: FR-DSH-050, FR-DSH-007.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/dashboard/format";
import { useMode } from "@/lib/dashboard/mode";
import { usePoll } from "@/lib/dashboard/use-poll";
import { cn } from "@/lib/utils";
import { useMerchant } from "./merchant-context";

export function CustomersList() {
  const { api } = useMerchant();
  const mode = useMode();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const fetcher = useCallback(() => api.listCustomers(mode, { search }), [api, mode, search]);
  const { data, loading, stale } = usePoll(fetcher);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="px-5 py-6 md:px-6">
      <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]">Customers</h1>
      <p className="mt-1 text-[14px] text-ink-soft">{stale ? "Reconnecting…" : "Everyone who has started a meter with you."}</p>
      <label className="relative mt-3 block max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or id"
          aria-label="Search customers"
          className="numerals h-10 w-full rounded-lg border border-input bg-transparent pr-3 pl-10 text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </label>
      {loading || !data ? (
        <Skeleton className="mt-5 h-72 w-full" />
      ) : data.length === 0 ? (
        <p className="mt-5 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">
          {search ? "No customer matches." : "No customers yet. They appear after their first checkout."}
        </p>
      ) : (
        <ol aria-label="Customers" className="mt-5 divide-y divide-border rounded-lg border border-border">
          {data.map((c) => {
            const href = `/dashboard/customers/${c.id}`;
            const current = pathname === href;
            return (
              <li key={c.id}>
                <Link href={href} aria-current={current ? "page" : undefined} className={cn("relative flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60", current && "bg-muted")}>
                  {current && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[14px]", c.email ? "numerals font-medium" : "text-ink-soft")}>{c.email ?? "Passkey user"}</span>
                    <span className="numerals flex flex-wrap gap-x-2 text-[12px] text-ink-soft">
                      <span>{c.id}</span>
                      <span className="whitespace-nowrap">
                        {c.subscriptionCount} {c.subscriptionCount === 1 ? "subscription" : "subscriptions"}
                      </span>
                      <span className="whitespace-nowrap">joined {timeAgo(c.createdAt, now)}</span>
                    </span>
                  </span>
                  <span className="numerals shrink-0 text-[13px]">${c.totalSettledUsd}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
