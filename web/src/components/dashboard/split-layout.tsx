/**
 * `SplitLayout` — the dashboard's list-and-detail structure (assigned by
 * the structure roll, seed 1fb0c5d3). From `lg` the list stays on the left
 * and the selected row's detail opens on the right without leaving the
 * list. Below `lg` exactly one pane shows: the detail when a row is
 * selected (with a back link), otherwise the list.
 *
 * Maps to: FR-DSH-009; design decision "split list + detail pane".
 */
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function SplitLayout({
  list,
  detail,
  hasDetail,
  backHref,
  backLabel,
  className,
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  /** True when a row is selected (a child segment is active). */
  hasDetail: boolean;
  backHref: string;
  backLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]", className)}>
      <div className={cn("min-w-0 lg:block lg:border-r lg:border-border", hasDetail && "hidden")}>{list}</div>
      <div className={cn("min-w-0 lg:sticky lg:top-14 lg:block lg:max-h-[calc(100dvh-3.5rem)] lg:self-start lg:overflow-y-auto", !hasDetail && "hidden")}>
        {hasDetail && (
          <Link
            href={backHref}
            className="inline-flex h-11 items-center gap-1 px-5 text-[13px] text-ink-soft hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </Link>
        )}
        {detail}
      </div>
    </div>
  );
}

/** What the detail pane shows before a row is chosen (desktop only). */
export function DetailPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden min-h-[60dvh] items-center justify-center px-8 text-center text-[14px] text-ink-soft lg:flex">
      <p>{children}</p>
    </div>
  );
}
