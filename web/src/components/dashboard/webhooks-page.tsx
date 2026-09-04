/**
 * `WebhooksPage` — `/dashboard/developers/webhooks`.
 *
 * Endpoints as rows: URL, subscribed events, Enabled/Disabled word, 7-day
 * success rate. Add opens the form; success reveals the `whsec_` once.
 *
 * Maps to: FR-DSH-080, FR-DSH-081, FR-DSH-112; BR-DSH-001, BR-DSH-003.
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { useMode } from "@/lib/dashboard/mode";
import type { WebhookEndpoint } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { EndpointFormDialog, type EndpointForm } from "./endpoint-dialogs";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import { StatusChip } from "./status-chip";

export function eventsWord(events: WebhookEndpoint["events"]): string {
  return events === "*" ? "All events" : `${events.length} event ${events.length === 1 ? "type" : "types"}`;
}

export function WebhooksPage() {
  const { api } = useMerchant();
  const mode = useMode();
  const fetcher = useCallback(() => api.listEndpoints(mode), [api, mode]);
  const { data, loading, stale, reload } = usePoll(fetcher);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const add = async (form: EndpointForm) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createEndpoint(mode, form, { idempotencyKey: newIdempotencyKey() });
      setAdding(false);
      setSecret(res.secret);
      await reload();
    } catch (e) {
      setError(e instanceof DashboardApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        lede={stale ? "Reconnecting…" : "Where your server hears about meters starting, settling, and stopping."}
        actions={
          <Button onClick={() => setAdding(true)} className="h-9">
            <Plus data-icon="inline-start" className="size-4" />
            Add endpoint
          </Button>
        }
      />
      {loading || !data ? (
        <Skeleton className="mt-8 h-40 w-full" />
      ) : data.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border px-4 py-12 text-center">
          <p className="text-[14px]">No endpoints yet.</p>
          <p className="mt-1 text-[13px] text-ink-soft">Add one and we&apos;ll POST every lifecycle event to it, signed.</p>
          <Button variant="outline" onClick={() => setAdding(true)} className="mt-4 h-9">
            Add endpoint
          </Button>
        </div>
      ) : (
        <ol aria-label="Endpoints" className="mt-8 divide-y divide-border rounded-lg border border-border">
          <li aria-hidden className="hidden grid-cols-[minmax(0,3fr)_minmax(0,1.2fr)_6rem_7.5rem_1.5rem] gap-4 bg-muted/60 px-4 py-2.5 md:grid">
            <span className="placard">Endpoint</span>
            <span className="placard">Events</span>
            <span className="placard">Status</span>
            <span className="placard text-right">7-day success</span>
            <span />
          </li>
          {data.map((e) => (
            <li key={e.id}>
              <Link
                href={`/dashboard/developers/webhooks/${e.id}`}
                className="grid gap-2 px-4 py-3 transition-colors hover:bg-muted/60 md:grid-cols-[minmax(0,3fr)_minmax(0,1.2fr)_6rem_7.5rem_1.5rem] md:items-center md:gap-4"
              >
                <span className="numerals min-w-0 truncate text-[13px]">{e.url}</span>
                <span className="text-[13px] text-ink-soft">{eventsWord(e.events)}</span>
                <span>
                  <StatusChip tone={e.disabled ? "muted" : "neutral"}>{e.disabled ? "Disabled" : "Enabled"}</StatusChip>
                </span>
                <span className="numerals text-[13px] md:text-right">
                  <span className="placard mr-2 md:hidden">7-day success</span>
                  {Math.round(e.successRate7d * 100)}%
                </span>
                <ChevronRight className="hidden size-4 text-ink-soft md:block" />
              </Link>
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <EndpointFormDialog
          open
          title="Add endpoint"
          submitLabel="Add endpoint"
          error={error}
          busy={busy}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
          onSubmit={add}
        />
      )}
      <SecretRevealDialog
        secret={secret}
        title="Signing secret"
        description="Verify every delivery with it: elapse.webhooks.constructEvent(body, signature, secret)."
        onClose={() => setSecret(null)}
      />
    </Page>
  );
}
