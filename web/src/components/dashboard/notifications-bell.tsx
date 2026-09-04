/**
 * `NotificationsBell` — the top-bar bell: unread count for the current
 * mode, a list newest first (kind, one line, time, link), "Mark all
 * read", and a line when the other mode has unread items.
 *
 * Maps to: FR-DSH-130, FR-DSH-132, FR-DSH-133.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { timeAgo } from "@/lib/dashboard/format";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import { useMode } from "@/lib/dashboard/mode";
import type { Notification } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { cn } from "@/lib/utils";

const KIND_WORD: Record<Notification["kind"], string> = {
  endpoint_exhausted: "Webhook stopped retrying",
  key_expiring: "Key expiring",
  secret_expiring: "Signing secret expiring",
  payment_failed: "Payment failed",
  first_delivery: "First delivery",
};

export function NotificationsBell({ api }: { api: DashboardApi | null }) {
  const mode = useMode();
  const other = mode === "test" ? "live" : "test";
  const fetcher = useCallback(async () => {
    if (!api) return { list: [] as Notification[], counts: { test: 0, live: 0 } };
    return { list: await api.listNotifications(mode), counts: await api.unreadCounts() };
  }, [api, mode]);
  const { data, reload } = usePoll(fetcher, { intervalMs: 30_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const unread = data?.counts[mode] ?? 0;
  const otherUnread = data?.counts[other] ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} className="relative size-9 text-ink-soft hover:text-foreground" />}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="numerals absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-md bg-caution-soft px-1 text-[10px] font-medium text-caution" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between font-normal">
            <span className="text-ink-soft">
              {data && data.list.length > 0 ? `${unread} unread` : "No notifications yet."}
            </span>
            {unread > 0 && api && (
              <button
                type="button"
                onClick={async () => {
                  await api.markNotificationsRead(mode);
                  await reload();
                }}
                className="text-[12px] text-ink-soft underline-offset-4 hover:text-foreground hover:underline"
              >
                Mark all read
              </button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {data && data.list.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuGroup>
          <ol aria-label="Notifications" className="max-h-80 overflow-y-auto">
            {data?.list.slice(0, 20).map((n) => (
              <li key={n.id}>
                <DropdownMenuItem render={<Link href={n.href} />} className={cn("flex-col items-start gap-0.5 py-2", !n.readAt && "bg-muted/60")}>
                  <span className="flex w-full items-center justify-between gap-2 text-[12px]">
                    <span className={cn("font-medium", n.kind === "payment_failed" || n.kind === "endpoint_exhausted" ? "text-caution" : "text-foreground")}>{KIND_WORD[n.kind]}</span>
                    <span className="numerals text-ink-soft">{timeAgo(n.createdAt, now)}</span>
                  </span>
                  <span className="text-[12px] text-ink-soft [overflow-wrap:anywhere]">{n.summary}</span>
                  {n.emailedAt && <span className="text-[11px] text-ink-soft">Emailed you at {new Date(n.emailedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
                </DropdownMenuItem>
              </li>
            ))}
          </ol>
        </DropdownMenuGroup>
        {otherUnread > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal text-ink-soft">
                {otherUnread} unread in {other} mode
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
