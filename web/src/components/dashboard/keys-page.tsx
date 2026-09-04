/**
 * `KeysPage` — `/dashboard/developers/keys`.
 *
 * The publishable key for the current mode in full with a copy control;
 * the secret keys as rows (name, masked key, created, last used, status
 * word, actions). Create reveals once; roll asks for a grace period and
 * reveals the new key; revoke confirms by name and keeps the row.
 *
 * Maps to: FR-DSH-070…074, FR-DSH-112; BR-DSH-001, BR-DSH-003, BR-DSH-010.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/site/copy-button";
import { expiresIn, timeAgo } from "@/lib/dashboard/format";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { useMode } from "@/lib/dashboard/mode";
import type { ApiKey } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { cn } from "@/lib/utils";
import { CreateKeyDialog, RevokeKeyDialog, RollKeyDialog } from "./key-dialogs";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { SecretRevealDialog } from "./secret-reveal-dialog";
import { StatusChip, type ChipTone } from "./status-chip";

const TONE: Record<ApiKey["status"], ChipTone> = { active: "neutral", expiring: "caution", expired: "muted", revoked: "destructive" };

export function KeysPage() {
  const { api } = useMerchant();
  const mode = useMode();
  const fetcher = useCallback(() => api.listKeys(mode), [api, mode]);
  const { data, loading, stale, reload } = usePoll(fetcher);

  const [creating, setCreating] = useState(false);
  const [rolling, setRolling] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const create = (name: string) =>
    run(async () => {
      const { secret } = await api.createKey(mode, name, { idempotencyKey: newIdempotencyKey() });
      setCreating(false);
      setRevealed({ secret, title: `${name} · secret key` });
    });

  const roll = (graceMs: number) =>
    run(async () => {
      if (!rolling) return;
      const { secret } = await api.rollKey(rolling.id, { graceMs, idempotencyKey: newIdempotencyKey() });
      setRolling(null);
      setRevealed({ secret, title: `${rolling.name} · new secret key` });
    });

  const revoke = () =>
    run(async () => {
      if (!revoking) return;
      await api.revokeKey(revoking.id, { idempotencyKey: newIdempotencyKey() });
      setRevoking(null);
      toast.success(`Revoked ${revoking.name}`);
    });

  return (
    <Page>
      <PageHeader
        title="API keys"
        lede={stale ? "Reconnecting…" : mode === "test" ? "Test keys talk to the testnet. Nothing here moves real money." : "Live keys move real money. Keep them on the server."}
        actions={
          <Button onClick={() => setCreating(true)} className="h-9">
            <Plus data-icon="inline-start" className="size-4" />
            Create secret key
          </Button>
        }
      />

      {data?.secret.some((k) => k.status === "expiring") && (
        <p role="status" aria-label="Expiring keys" className="mt-6 rounded-lg border border-caution/25 bg-caution-soft px-4 py-3 text-[13px]">
          <span className="font-semibold text-caution">A rolled key is still in its grace period.</span>{" "}
          <span className="text-ink-soft">Deploy the new key before the old one expires; requests with the old key fail after that.</span>
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Publishable key</h2>
        <p className="mt-1 text-[13px] text-ink-soft">Safe in a browser. It can only read checkout sessions.</p>
        {loading || !data ? (
          <Skeleton className="mt-3 h-11 w-full max-w-xl" />
        ) : (
          <div className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-border bg-card pl-3">
            <code className="numerals min-w-0 flex-1 break-all py-2.5 text-[13px] md:truncate">{data.publishable}</code>
            <CopyButton text={data.publishable} label="Copy publishable key" />
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">Secret keys</h2>
        <p className="mt-1 text-[13px] text-ink-soft">Server-side only. Shown once at creation; roll with a grace period, never with downtime.</p>
        {loading || !data ? (
          <Skeleton className="mt-4 h-40 w-full" />
        ) : data.secret.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border px-4 py-10 text-center">
            <p className="text-[14px]">No secret keys yet.</p>
            <p className="mt-1 text-[13px] text-ink-soft">Create one to call the API from your server.</p>
            <Button variant="outline" onClick={() => setCreating(true)} className="mt-4 h-9">
              Create secret key
            </Button>
          </div>
        ) : (
          <ol aria-label="Secret keys" className="mt-4 divide-y divide-border rounded-lg border border-border">
            <li aria-hidden className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_2.5rem] gap-4 bg-muted/60 px-4 py-2.5 md:grid">
              <span className="placard">Key</span>
              <span className="placard">Created</span>
              <span className="placard">Last used</span>
              <span className="placard">Status</span>
              <span />
            </li>
            {data.secret.map((k) => (
              <KeyRow key={k.id} k={k} now={now} onRoll={() => setRolling(k)} onRevoke={() => setRevoking(k)} />
            ))}
          </ol>
        )}
      </section>

      <CreateKeyDialog open={creating} onCancel={() => setCreating(false)} onCreate={create} busy={busy} />
      <RollKeyDialog target={rolling} onCancel={() => setRolling(null)} onRoll={roll} busy={busy} />
      <RevokeKeyDialog target={revoking} onCancel={() => setRevoking(null)} onRevoke={revoke} busy={busy} />
      <SecretRevealDialog
        secret={revealed?.secret ?? null}
        title={revealed?.title ?? ""}
        description="Copy it into your server's environment now."
        onClose={() => setRevealed(null)}
      />
    </Page>
  );
}

function KeyRow({ k, now, onRoll, onRevoke }: { k: ApiKey; now: number; onRoll: () => void; onRevoke: () => void }) {
  const dead = k.status === "revoked" || k.status === "expired";
  const statusWord =
    k.status === "expiring" && k.expiresAt ? `Expires in ${expiresIn(k.expiresAt, now)}` : k.status[0]!.toUpperCase() + k.status.slice(1);
  return (
    <li className={cn("relative grid gap-2 px-4 py-3 pr-14 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem_2.5rem] md:items-center md:gap-4 md:pr-4", dead && "text-ink-soft")}>
      <div className="min-w-0">
        <p className={cn("truncate text-[14px] font-medium", dead ? "text-ink-soft" : "text-foreground")}>{k.name}</p>
        <p className="numerals truncate text-[12px] text-ink-soft">
          {k.prefix}…{k.last4}
        </p>
      </div>
      <p className="text-[13px] text-ink-soft">
        <span className="placard mr-2 md:hidden">Created</span>
        {timeAgo(k.createdAt, now)}
      </p>
      <p className="text-[13px] text-ink-soft">
        <span className="placard mr-2 md:hidden">Last used</span>
        {k.lastUsedAt ? timeAgo(k.lastUsedAt, now) : "Never"}
      </p>
      <div>
        <StatusChip tone={TONE[k.status]}>{statusWord}</StatusChip>
      </div>
      <RowMenu name={k.name} disabled={dead} onRoll={onRoll} onRevoke={onRevoke} className="absolute top-1.5 right-1 md:static" />
    </li>
  );
}

function RowMenu({ name, disabled, onRoll, onRevoke, className }: { name: string; disabled: boolean; onRoll: () => void; onRevoke: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={<Button variant="ghost" size="icon" aria-label={`Actions for ${name}`} className={cn("size-11 text-ink-soft hover:text-foreground md:size-9", className)} />}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onRoll}>Roll key…</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onRevoke}>
          Revoke key…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
