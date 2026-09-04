/**
 * `EventDetail` — the right pane of Events: the full payload as JSON with
 * Copy, and the deliveries this event produced with links to their
 * endpoints.
 *
 * Maps to: FR-DSH-091.
 */
"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBlock } from "@/components/site/code-block";
import { clock } from "@/lib/dashboard/format";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import { usePoll } from "@/lib/dashboard/use-poll";
import { DELIVERY_TONE, deliveryWord } from "./delivery-status";
import { useMerchant } from "./merchant-context";
import { StatusChip } from "./status-chip";

export function EventDetail({ eventId }: { eventId: string }) {
  const { api } = useMerchant();
  const fetcher = useCallback(() => api.getEvent(eventId), [api, eventId]);
  const { data, loading, error } = usePoll(fetcher);

  if (error instanceof DashboardApiError && error.code === "not_found") {
    return (
      <div className="px-5 py-6 md:px-8">
        <p className="text-[15px]">We can&apos;t find this event.</p>
        <p className="mt-1 text-[13px] text-ink-soft">It may belong to the other mode. Switch Test / Live and try again.</p>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="px-5 py-6 md:px-8" aria-busy>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }
  const { event, deliveries } = data;
  const json = JSON.stringify(event.payload, null, 2);
  return (
    <div className="px-5 py-6 md:px-8">
      <h2 className="numerals text-[1.125rem] font-medium tracking-[-0.01em]">{event.type}</h2>
      <p className="numerals mt-1 text-[12px] text-ink-soft">
        {event.id} · {clock(event.createdAt)}
        {event.pendingWebhooks > 0 && (
          <span className="ml-2 text-caution">
            {event.pendingWebhooks} pending {event.pendingWebhooks === 1 ? "webhook" : "webhooks"}
          </span>
        )}
      </p>

      <section className="mt-6" data-testid="event-payload">
        <CodeBlock code={json} title="payload.json" lang="json" wrap copyLabel="Copy payload" />
      </section>

      <section className="mt-8">
        <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Deliveries</h3>
        {deliveries.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border px-4 py-6 text-center text-[13px] text-ink-soft">
            No endpoint was subscribed to this type when it happened.
          </p>
        ) : (
          <ol aria-label="Deliveries" className="mt-3 divide-y divide-border rounded-lg border border-border">
            {deliveries.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/dashboard/developers/webhooks/${d.endpoint.id}`}
                  className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <span className="numerals min-w-0 flex-1 truncate text-[13px]">{d.endpoint.url}</span>
                  <StatusChip tone={DELIVERY_TONE[d.status]}>{deliveryWord(d)}</StatusChip>
                  <span className="numerals w-12 shrink-0 text-right text-[12px] text-ink-soft">
                    {d.attempt} / {d.maxAttempts}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
