/**
 * Settings sections: business profile, payout address, fee, notification
 * switches, danger zone. Each is a bounded form that talks to the API
 * with an idempotency key and reports through the merchant context.
 *
 * Maps to: FR-DSH-100, FR-DSH-101, FR-DSH-102, FR-DSH-104, FR-DSH-105; BR-DSH-010.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "@/components/site/copy-button";
import { shortHex } from "@/lib/dashboard/format";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { DashboardApiError } from "@/lib/dashboard/mock-api";
import { usePoll } from "@/lib/dashboard/use-poll";
import { useMerchant } from "./merchant-context";

export function Section({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h2>
        {lede && <p className="mt-1 text-[13px] text-ink-soft">{lede}</p>}
      </div>
      <div className="min-w-0 max-w-xl">{children}</div>
    </section>
  );
}

export function ProfileSection() {
  const { api, merchant, setMerchant } = useMerchant();
  const [name, setName] = useState(merchant.name ?? "");
  const [supportEmail, setSupportEmail] = useState(merchant.supportEmail ?? "");
  const [supportUrl, setSupportUrl] = useState(merchant.supportUrl ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      setMerchant(await api.updateMerchant({ name, supportEmail, supportUrl }, { idempotencyKey: newIdempotencyKey() }));
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Business profile" lede="What subscribers and your team see.">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="biz-name">Business name</Label>
          <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="biz-support-email">Support email</Label>
          <Input id="biz-support-email" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} className="numerals h-10 text-[14px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="biz-support-url">Support URL</Label>
          <Input id="biz-support-url" type="url" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} className="numerals h-10 text-[14px]" />
        </div>
        <div>
          <Button type="submit" disabled={busy} className="h-9">
            {busy ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function PayoutSection() {
  const { api, merchant, setMerchant } = useMerchant();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setMerchant(await api.changePayoutAddress({ address, confirm }, { idempotencyKey: newIdempotencyKey() }));
      setOpen(false);
      setAddress("");
      setConfirm("");
      toast.success("Payout address changed. It applies from the next settlement.");
    } catch (err) {
      setError(err instanceof DashboardApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Payout" lede="Settled funds arrive here automatically. Elapse never holds your balance.">
      <div className="flex flex-col gap-3">
        {merchant.payoutAddress ? (
          <p className="numerals flex items-center gap-1 text-[14px]">
            {shortHex(merchant.payoutAddress)}
            <CopyButton text={merchant.payoutAddress} label="Copy payout address" className="size-7" />
          </p>
        ) : (
          <p className="text-[14px] text-ink-soft">No payout address yet. Settlements wait until you set one.</p>
        )}
        <div>
          <Button variant="outline" onClick={() => setOpen(true)} className="h-9">
            {merchant.payoutAddress ? "Change payout address" : "Set payout address"}
          </Button>
        </div>
        <p className="text-[13px] text-ink-soft">
          Platform fee: {merchant.feeBps / 100} % of every settlement.{" "}
          <a href="mailto:hello@elapse.finance?subject=Volume%20pricing" className="text-foreground underline-offset-4 hover:underline">
            Contact us for volume pricing
          </a>
          .
        </p>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <form onSubmit={change} className="contents" noValidate>
            <DialogHeader>
              <DialogTitle>{merchant.payoutAddress ? "Change payout address" : "Set payout address"}</DialogTitle>
              <DialogDescription>Every future settlement pays here. Type it twice; a typo would send your revenue to a stranger.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payout-new">New address</Label>
              <Input id="payout-new" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} autoFocus className="numerals h-10 text-[13px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payout-confirm">Type it again</Label>
              <Input id="payout-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="0x…" spellCheck={false} aria-invalid={error ? true : undefined} className="numerals h-10 text-[13px]" />
              {error && (
                <p role="alert" className="text-[13px] text-caution">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9">
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="h-9">
                {busy ? "Changing…" : "Change address"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export function NotificationsSection() {
  const { api } = useMerchant();
  const fetcher = useCallback(() => api.getNotificationSettings(), [api]);
  const { data, reload } = usePoll(fetcher, { intervalMs: 60_000 });
  const set = async (patch: Partial<{ emailOnExhausted: boolean; emailOnExpiring: boolean }>) => {
    try {
      await api.updateNotificationSettings(patch, { idempotencyKey: newIdempotencyKey() });
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };
  return (
    <Section title="Notifications" lede="Emails go to your account address. The bell in the top bar always shows everything.">
      <div className="divide-y divide-border rounded-lg border border-border">
        <label className="flex items-start justify-between gap-4 px-4 py-3">
          <span>
            <span className="block text-[14px] font-medium">Webhook endpoint stopped retrying</span>
            <span className="block text-[12px] text-ink-soft">After the 8th failed attempt on any delivery.</span>
          </span>
          <Switch aria-label="Email when a webhook endpoint stopped retrying" checked={data?.emailOnExhausted ?? true} onCheckedChange={(v) => set({ emailOnExhausted: v })} disabled={!data} />
        </label>
        <label className="flex items-start justify-between gap-4 px-4 py-3">
          <span>
            <span className="block text-[14px] font-medium">API key or signing secret about to expire</span>
            <span className="block text-[12px] text-ink-soft">24 hours and 1 hour before a rolled key or secret stops working.</span>
          </span>
          <Switch aria-label="Email when an API key or signing secret is about to expire" checked={data?.emailOnExpiring ?? true} onCheckedChange={(v) => set({ emailOnExpiring: v })} disabled={!data} />
        </label>
      </div>
    </Section>
  );
}

export function DangerSection() {
  const { api, merchant } = useMerchant();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const name = merchant.name ?? "";
  const del = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteTestData({ confirmName: typed }, { idempotencyKey: newIdempotencyKey() });
      setOpen(false);
      setTyped("");
      toast.success("Test data deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Danger zone" lede="Irreversible. Live data is never touched here.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-[14px] font-medium">Delete test data</span>
            <span className="block text-[12px] text-ink-soft">Products, meters, keys, endpoints, events and the ledger in test mode.</span>
          </span>
          <Button variant="destructive" onClick={() => setOpen(true)} className="h-9 shrink-0">
            Delete test data
          </Button>
        </div>
        <p className="text-[13px] text-ink-soft">
          To close your account,{" "}
          <a href="mailto:hello@elapse.finance?subject=Close%20my%20account" className="text-foreground underline-offset-4 hover:underline">
            email us
          </a>
          . We confirm within one business day.
        </p>
      </div>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all test data?</DialogTitle>
            <DialogDescription>Every test-mode object goes away, including keys your integration may be using. Live mode is untouched.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="danger-confirm">Type {name} to confirm</Label>
            <Input id="danger-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="h-10" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="h-9">
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || typed.trim() !== name} onClick={del} className="h-9">
              {busy ? "Deleting…" : "Delete everything in test mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
