/**
 * `EventsList` — the left pane of `/dashboard/developers/events`: every
 * event in the current mode, newest first, with a type filter. The active
 * row follows the route.
 *
 * Maps to: FR-DSH-090, FR-DSH-007.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/dashboard/format";
import { useMode } from "@/lib/dashboard/mode";
import { EVENT_TYPES, type Event, type EventType } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { cn } from "@/lib/utils";
import { useMerchant } from "./merchant-context";
import { ShowMore } from "./show-more";

const WORD: Record<Event["deliveryState"], string> = { pending: "Pending", delivered: "Delivered", failed: "Failed" };
const PAGE = 50;

export function EventsList() {
  const { api } = useMerchant();
  const mode = useMode();
  const pathname = usePathname();
  const [type, setType] = useState<EventType | "">("");
  const fetcher = useCallback(() => api.listEvents(mode, type ? { type } : {}), [api, mode, type]);
  const { data, loading, stale } = usePoll(fetcher);
  const paged = useShowMore(data, PAGE);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="px-5 py-6 md:px-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]">Events</h1>
          <p className="mt-1 text-[14px] text-ink-soft">{stale ? "Reconnecting…" : "Everything that happened, and whether your server heard."}</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-ink-soft">
          Filter by type
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setType(e.target.value as EventType | "")}
            className="numerals h-9 max-w-[14rem] rounded-lg border border-input bg-transparent px-2.5 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading || !data ? (
        <Skeleton className="mt-5 h-72 w-full" />
      ) : data.length === 0 ? (
        <p className="mt-5 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">
          {type ? "No events of this type yet." : "No events yet. Start a meter from a checkout link and they appear here."}
        </p>
      ) : (
        <ol aria-label="Events" className="mt-5 divide-y divide-border rounded-lg border border-border">
          {paged.visible.map((e) => {
            const href = `/dashboard/developers/events/${e.id}`;
            const current = pathname === href;
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col gap-1 px-4 py-2 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3",
                    current && "bg-muted",
                  )}
                >
                  {current && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="numerals block text-[13px] [overflow-wrap:anywhere]">{e.type}</span>
                    <span className="numerals block text-[12px] text-ink-soft [overflow-wrap:anywhere]">
                      {e.id} · {e.objectId}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 sm:contents">
                    <span
                      className={cn(
                        "shrink-0 text-[12px]",
                        e.deliveryState === "failed" ? "text-destructive" : e.deliveryState === "pending" ? "text-caution" : "text-ink-soft",
                      )}
                    >
                      {WORD[e.deliveryState]}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-soft sm:w-14 sm:text-right">{timeAgo(e.createdAt, now)}</span>
                  </span>
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
