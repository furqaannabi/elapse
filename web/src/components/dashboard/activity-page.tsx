/**
 * `ActivityPage` — `/dashboard/settings/activity`: the audit log, read
 * only. Time, actor, action word, target id, IP. Filter by action and
 * date; CSV export. Never a secret value (FR-DSH-142).
 *
 * Maps to: FR-DSH-140, FR-DSH-141, FR-DSH-142; BR-DSH-011.
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditAction, AuditEntry } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { ShowMore } from "./show-more";

export const ACTION_WORD: Record<AuditAction, string> = {
  signin: "Signed in",
  "key.created": "Key created",
  "key.rolled": "Key rolled",
  "key.revoked": "Key revoked",
  "secret.revealed": "Secret revealed",
  "secret.rolled": "Signing secret rolled",
  "endpoint.added": "Endpoint added",
  "endpoint.changed": "Endpoint changed",
  "endpoint.disabled": "Endpoint disabled",
  "endpoint.enabled": "Endpoint enabled",
  "payout_address.changed": "Payout address changed",
  "delivery.resent": "Delivery resent",
  "test_data.deleted": "Test data deleted",
};

export function activityCsv(rows: AuditEntry[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["at,actor,action,target,ip", ...rows.map((a) => [new Date(a.at).toISOString(), a.actor, a.action, a.target, a.ip].map(esc).join(","))].join("\n") + "\n";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ActivityPage() {
  const { api } = useMerchant();
  const [action, setAction] = useState<AuditAction | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fetcher = useCallback(
    () => api.listActivity({ action: action || undefined, since: from ? new Date(from).getTime() : undefined, until: to ? new Date(to).getTime() + 86_399_999 : undefined }),
    [api, action, from, to],
  );
  const { data, loading, stale } = usePoll(fetcher, { intervalMs: 30_000 });
  const paged = useShowMore(data, 50);
  const input = "numerals h-9 rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  return (
    <Page>
      <Link href="/dashboard/settings" className="inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Link>
      <PageHeader
        className="mt-3"
        title="Activity"
        lede={stale ? "Reconnecting…" : "Who changed what, and when. Read-only; both modes."}
        actions={
          <Button variant="outline" disabled={!data || data.length === 0} onClick={() => data && download("elapse-activity.csv", activityCsv(data))} className="h-9">
            <Download data-icon="inline-start" className="size-4" />
            Export CSV
          </Button>
        }
      />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-ink-soft">
          Action
          <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value as AuditAction | "")} className={input}>
            <option value="">All</option>
            {(Object.keys(ACTION_WORD) as AuditAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_WORD[a]}
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
      </div>
      {loading || !data ? (
        <Skeleton className="mt-4 h-64 w-full" />
      ) : data.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">No activity matches.</p>
      ) : (
        <ol aria-label="Activity" className="mt-4 divide-y divide-border rounded-lg border border-border">
          <li aria-hidden className="hidden grid-cols-[10rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] gap-3 bg-muted/60 px-4 py-2.5 md:grid">
            <span className="placard">When</span>
            <span className="placard">Action</span>
            <span className="placard">Actor</span>
            <span className="placard">Target</span>
            <span className="placard">IP</span>
          </li>
          {paged.visible.map((a) => (
            <li key={a.id} className="grid gap-x-3 gap-y-1 px-4 py-3 text-[13px] md:grid-cols-[10rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] md:items-center">
              <span className="numerals text-ink-soft">{new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span className="font-medium">{ACTION_WORD[a.action]}</span>
              <span className="numerals truncate text-ink-soft">{a.actor}</span>
              <span className="numerals truncate">{a.target}</span>
              <span className="numerals text-ink-soft">{a.ip}</span>
            </li>
          ))}
        </ol>
      )}
      <ShowMore remaining={paged.remaining} onMore={paged.more} />
    </Page>
  );
}
