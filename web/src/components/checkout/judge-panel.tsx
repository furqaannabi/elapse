/**
 * `JudgePanel` — the one place chain detail is allowed on the subscriber
 * surface. A bottom sheet, hidden by default, showing chain id, contract
 * and stream addresses, a live block ticker, indexer lag, and the webhook
 * deliveries for this session. Looks like an observability panel, not a
 * block explorer.
 *
 * Maps to: FR-CHK-011; BR-CHK-001 (exception).
 */
"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { JudgeData } from "@/lib/checkout/mock-api";

export function JudgePanel({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: JudgeData | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[640px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0 pt-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="placard">Judge mode</span>
            <span className="text-ink-soft">·</span>
            <span className="font-medium">{data?.chainName ?? "…"}</span>
          </SheetTitle>
          <SheetDescription className="text-ink-soft">
            The instrument behind the meter. Subscribers never see this panel.
          </SheetDescription>
        </SheetHeader>

        {data ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-soft">Chain</dt>
              <dd className="numerals text-right">{data.chainId}</dd>
              <dt className="text-ink-soft">Block</dt>
              <dd className="numerals text-right">
                <BlockTicker blockTimeMs={data.blockTimeMs} />
                <span className="text-ink-soft"> · {data.blockTimeMs} ms</span>
              </dd>
              <dt className="text-ink-soft">Indexer lag</dt>
              <dd className="numerals text-right">{data.indexerLagBlocks} block</dd>
              <dt className="text-ink-soft">Factory</dt>
              <dd className="numerals truncate text-right text-xs">{data.contractAddress}</dd>
              <dt className="text-ink-soft">Stream</dt>
              <dd className="numerals truncate text-right text-xs">
                {data.streamAddress ?? "not created yet"}
              </dd>
            </dl>

            <div>
              <p className="placard mb-2">Webhook deliveries · merchant server</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <span className="numerals text-[13px]">{d.type}</span>
                    <span className="numerals shrink-0 text-xs text-ink-soft">
                      <span className="text-live">{d.status ?? "…"}</span> · #{d.attempt} ·{" "}
                      {new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </li>
                ))}
                {data.deliveries.length === 0 && (
                  <li className="px-3 py-3 text-sm text-ink-soft">No deliveries yet.</li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <p className="py-6 text-sm text-ink-soft">Loading…</p>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A number that ticks at the chain's block time — the "300 ms" proof. */
function BlockTicker({ blockTimeMs }: { blockTimeMs: number }) {
  const [n, setN] = useState(() => 21_450_000 + Math.floor(Date.now() / blockTimeMs) % 100_000);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), blockTimeMs);
    return () => clearInterval(id);
  }, [blockTimeMs]);
  return <span>#{n.toLocaleString()}</span>;
}
