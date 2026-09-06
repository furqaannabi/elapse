/**
 * `EndpointDetail` — `/dashboard/developers/webhooks/[id]`.
 *
 * The endpoint's URL and subscription, an Enabled switch, Edit, Send test
 * event, Roll signing secret; then the delivery log with a status filter.
 * A row opens the `DeliveryDrawer`. A disabled endpoint carries a notice
 * and its deliveries read Skipped.
 *
 * Maps to: FR-DSH-082, FR-DSH-083, FR-DSH-084, FR-DSH-085, FR-DSH-112.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/dashboard/format";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import type { Delivery, EventType, WebhookEndpoint } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { useShowMore } from "@/lib/dashboard/use-show-more";
import { DeliveryDrawer } from "./delivery-drawer";
import { DELIVERY_TONE, deliveryWord } from "./delivery-status";
import { EndpointFormDialog, RollSecretDialog, TestEventDialog, type EndpointForm } from "./endpoint-dialogs";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import { ShowMore } from "./show-more";
import { StatusChip } from "./status-chip";
import { eventsWord } from "./webhooks-page";

const STATUSES: Delivery["status"][] = ["pending", "succeeded", "failed", "exhausted", "skipped"];
const PAGE = 50;

export function EndpointDetail({ endpointId }: { endpointId: string }) {
  const { api } = useMerchant();
  const [filter, setFilter] = useState<Delivery["status"] | "">("");
  const fetcher = useCallback(async () => {
    const endpoint = (await api.listEndpoints("test")).concat(await api.listEndpoints("live")).find((e) => e.id === endpointId);
    if (!endpoint) throw new DashboardApiError("not_found", "No such endpoint");
    const deliveries = await api.listDeliveries(endpointId, filter ? { status: filter } : undefined);
    return { endpoint, deliveries };
  }, [api, endpointId, filter]);
  const { data, loading, stale, error, reload } = usePoll(fetcher);
  const paged = useShowMore(data?.deliveries, PAGE);

  const [open, setOpen] = useState<Delivery | null>(null);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rolling, setRolling] = useState<WebhookEndpoint | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn: () => Promise<void>, onError?: (m: string) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (onError) onError(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const ep = data?.endpoint;

  const toggle = (enabled: boolean) =>
    run(async () => {
      await api.updateEndpoint(endpointId, { disabled: !enabled }, { idempotencyKey: newIdempotencyKey() });
    });
  const edit = (form: EndpointForm) =>
    run(
      async () => {
        await api.updateEndpoint(endpointId, form, { idempotencyKey: newIdempotencyKey() });
        setEditing(false);
        setFormError(null);
      },
      setFormError,
    );
  const sendTest = (type: EventType) =>
    run(async () => {
      await api.sendTestEvent(endpointId, type, { idempotencyKey: newIdempotencyKey() });
      setTesting(false);
      toast.success(`Sent ${type}`);
    });
  const roll = (graceMs: number) =>
    run(async () => {
      const res = await api.rollEndpointSecret(endpointId, { graceMs, idempotencyKey: newIdempotencyKey() });
      setRolling(null);
      setSecret(res.secret);
    });
  // A row is a summary with the last attempt only; the drawer shows it at once and fills in every attempt.
  const openDelivery = (d: Delivery) => {
    setOpen(d);
    void api.getDelivery(d.id).then((full) => setOpen((cur) => (cur?.id === full.id ? full : cur)));
  };
  const resend = () =>
    run(async () => {
      if (!open) return;
      const after = await api.resendDelivery(open.id, { idempotencyKey: newIdempotencyKey() });
      setOpen(after);
    });

  if (error instanceof DashboardApiError && error.code === "not_found") {
    return (
      <Page>
        <p className="text-[15px]">We can&apos;t find this endpoint.</p>
        <Link href="/dashboard/developers/webhooks" className="mt-2 inline-block text-[13px] text-ink-soft underline-offset-4 hover:underline">
          Back to webhooks
        </Link>
      </Page>
    );
  }

  return (
    <Page>
      <Link href="/dashboard/developers/webhooks" className="inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Webhooks
      </Link>
      {loading || !ep ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : (
        <>
          <PageHeader
            className="mt-3"
            title={ep.url}
            titleClassName="numerals text-[1.125rem] font-medium [overflow-wrap:anywhere]"
            lede={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusChip tone={ep.disabled ? "muted" : "neutral"}>{ep.disabled ? "Disabled" : "Enabled"}</StatusChip>
                <span>{eventsWord(ep.events)}</span>
                <span className="numerals">{Math.round(ep.successRate7d * 100)}% success over 7 days</span>
                {stale && <span>Reconnecting…</span>}
              </span>
            }
            actions={
              <label className="flex h-9 items-center gap-2 text-[13px]">
                <Switch checked={!ep.disabled} onCheckedChange={toggle} disabled={busy} aria-label="Enabled" />
                Enabled
              </label>
            }
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-9">
              <Pencil data-icon="inline-start" className="size-3.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTesting(true)} disabled={ep.disabled} className="h-9">
              <Send data-icon="inline-start" className="size-3.5" />
              Send test event
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRolling(ep)} className="h-9">
              <KeyRound data-icon="inline-start" className="size-3.5" />
              Roll signing secret
            </Button>
          </div>
          {ep.disabled && (
            <p role="status" aria-label="Disabled" className="mt-4 rounded-lg border border-border bg-muted/60 px-4 py-3 text-[13px]">
              <span className="font-semibold">This endpoint is disabled.</span>{" "}
              <span className="text-ink-soft">New deliveries are skipped, not queued. Enabling it does not replay them; use Resend on any you need.</span>
            </p>
          )}
          {ep.previousSecretExpiresAt && ep.previousSecretExpiresAt > now && (
            <p className="mt-4 text-[13px] text-ink-soft">
              Signing with both secrets until {new Date(ep.previousSecretExpiresAt).toLocaleString()}.
            </p>
          )}
        </>
      )}

      <section className="mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Deliveries</h2>
            <p className="mt-1 text-[13px] text-ink-soft">Every attempt to POST an event here, newest first.</p>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            Filter by status
            <select
              aria-label="Filter by status"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Delivery["status"] | "")}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!data ? (
          <Skeleton className="mt-4 h-64 w-full" />
        ) : data.deliveries.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border px-4 py-10 text-center text-[14px] text-ink-soft">
            {filter ? `No ${filter} deliveries.` : "No deliveries yet. Send a test event to see one."}
          </p>
        ) : (
          <ol aria-label="Deliveries" className="mt-4 divide-y divide-border rounded-lg border border-border">
            <li aria-hidden className="hidden grid-cols-[minmax(0,2fr)_6.5rem_5rem_4rem_6rem] gap-4 bg-muted/60 px-4 py-2.5 md:grid">
              <span className="placard">Event</span>
              <span className="placard">Status</span>
              <span className="placard">Attempt</span>
              <span className="placard">Code</span>
              <span className="placard text-right">When</span>
            </li>
            {paged.visible.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openDelivery(d)}
                  className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/60 md:grid-cols-[minmax(0,2fr)_6.5rem_5rem_4rem_6rem] md:items-center md:gap-4"
                >
                  <span className="min-w-0">
                    <span className="numerals block truncate text-[13px]">{d.event.type}</span>
                    <span className="numerals block truncate text-[12px] text-ink-soft">{d.event.id}</span>
                  </span>
                  <span>
                    <StatusChip tone={DELIVERY_TONE[d.status]}>{deliveryWord(d)}</StatusChip>
                  </span>
                  <span className="numerals text-[13px]">
                    <span className="placard mr-2 md:hidden">Attempt</span>
                    {d.attempt} / {d.maxAttempts}
                  </span>
                  <span className="numerals text-[13px] text-ink-soft">
                    <span className="placard mr-2 md:hidden">Code</span>
                    {d.lastResponseCode ?? "—"}
                  </span>
                  <span className="text-[12px] text-ink-soft md:text-right">{timeAgo(d.event.createdAt, now)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <ShowMore remaining={paged.remaining} onMore={paged.more} step={PAGE} />
      </section>

      <DeliveryDrawer delivery={open} onClose={() => setOpen(null)} onResend={resend} busy={busy} />
      {editing && ep && (
        <EndpointFormDialog
          open
          initial={{ url: ep.url, events: ep.events }}
          title="Edit endpoint"
          submitLabel="Save"
          error={formError}
          busy={busy}
          onCancel={() => {
            setEditing(false);
            setFormError(null);
          }}
          onSubmit={edit}
        />
      )}
      <TestEventDialog open={testing} busy={busy} onCancel={() => setTesting(false)} onSend={sendTest} />
      <RollSecretDialog target={rolling} busy={busy} onCancel={() => setRolling(null)} onRoll={roll} />
      <SecretRevealDialog secret={secret} title="New signing secret" description="Update your handler. The old secret keeps verifying until it expires." onClose={() => setSecret(null)} />
    </Page>
  );
}
