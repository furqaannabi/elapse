/**
 * `FirstRunForm` — the one screen a brand-new merchant sees before the
 * dashboard: business name (required) and payout address (optional, can be
 * set later in Settings). Not a wizard.
 *
 * Maps to: FR-DSH-013.
 */
"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/site/logo";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

export function FirstRunForm({
  api,
  email,
  onDone,
}: {
  api: DashboardApi;
  email: string;
  onDone: (m: Merchant) => void;
}) {
  const [name, setName] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError("Enter a business name to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await api.completeFirstRun({ name, payoutAddress: payout || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-[440px] px-5 pt-8">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 py-10">
        <h1 className="display-wide text-balance text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
          Name your business.
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          Signed in as <span className="numerals text-foreground">{email}</span>. Subscribers see this
          name on your checkout.
        </p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="business-name">Business name</Label>
            <Input
              id="business-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
              autoFocus
              required
              className="h-11 text-base"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payout-address">
              Payout address <span className="font-normal text-ink-soft">(optional)</span>
            </Label>
            <Input
              id="payout-address"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              className="numerals h-11 text-[15px]"
            />
            <p className="text-[13px] text-ink-soft">
              This is where settled funds arrive. You can set it later in Settings.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-caution">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy} className="mt-2 h-11 w-full text-[15px]">
            {busy ? "Saving…" : "Continue"}
            <ArrowRight data-icon="inline-end" className="size-4" />
          </Button>
        </form>
      </main>
    </div>
  );
}
