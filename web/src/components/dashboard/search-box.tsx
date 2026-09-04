/**
 * `SearchBox` — the top-bar lookup. Type an id (`sub_`, `cus_`, `evt_`,
 * `wh_`, `cs_`, `prod_`) or an email and press Enter; the matching detail
 * opens, or "No match" is said. Scoped to the current mode.
 *
 * Maps to: FR-DSH-005.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import { useMode } from "@/lib/dashboard/mode";
import { cn } from "@/lib/utils";

export function SearchBox({ api, onNavigate, size = "sm", className }: { api: DashboardApi | null; onNavigate?: () => void; size?: "sm" | "lg"; className?: string }) {
  const router = useRouter();
  const mode = useMode();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!api || busy || !q.trim()) return;
    setBusy(true);
    try {
      const href = await api.resolveSearch(mode, q);
      if (href) {
        router.push(href);
        setQ("");
        onNavigate?.();
      } else {
        toast.error(`No match for “${q.trim()}” in ${mode} mode.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
      className={cn("relative", className)}
    >
      <Search className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-soft", size === "lg" ? "left-3 size-4" : "left-2.5 size-3.5")} />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search ids or emails"
        aria-label="Search"
        disabled={!api}
        className={cn(
          "numerals w-full rounded-lg border border-input bg-transparent outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
          size === "lg" ? "h-11 pr-3 pl-10 text-[15px]" : "h-8 w-56 pr-2.5 pl-8 text-[13px]",
        )}
      />
    </form>
  );
}
