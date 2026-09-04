/**
 * `LoginForm` — email in, magic link out.
 *
 * Idle: one field, one button. Sent: "Check your inbox" naming the address,
 * with Resend limited to once per 30 s. When the API returns the token it
 * would have emailed (the mock does), a clearly-labelled development link
 * lets you follow it without an inbox.
 *
 * Maps to: FR-DSH-010.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDashboardApi } from "@/lib/dashboard/client";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import { cn } from "@/lib/utils";

export const RESEND_COOLDOWN_S = 30;

export function LoginForm({ api: injected }: { api?: DashboardApi }) {
  const api = injected ?? getDashboardApi();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; devToken?: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestMagicLink(email);
      setSent({ email: email.trim().toLowerCase(), devToken: res.devToken });
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const verifyHref = sent.devToken
      ? `/login/verify?token=${encodeURIComponent(sent.devToken)}${next ? `&next=${encodeURIComponent(next)}` : ""}`
      : null;
    return (
      <section className="flex flex-col gap-6">
        <MailCheck className="size-8 text-ink-soft" strokeWidth={1.5} />
        <div>
          <h1 className="display-wide text-balance text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
            Check your inbox.
          </h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            We sent a sign-in link to <span className="numerals text-foreground">{sent.email}</span>. It
            works once and expires in 15 minutes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={send} disabled={cooldown > 0 || busy} className="h-10">
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
          </Button>
          <button
            type="button"
            onClick={() => setSent(null)}
            className="text-[13px] text-ink-soft underline-offset-4 hover:text-foreground hover:underline"
          >
            Use a different email
          </button>
        </div>
        {verifyHref && (
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <p className="placard">Development</p>
            <p className="mt-2 text-[13px] text-ink-soft">
              No email is sent from the mock. Open the link it would have contained:
            </p>
            <Link href={verifyHref} className={cn(buttonVariants({ size: "sm" }), "mt-3 h-9")}>
              Open sign-in link
              <ArrowRight data-icon="inline-end" className="size-3.5" />
            </Link>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="display-wide text-balance text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
          Sign in to Elapse.
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          We&apos;ll email you a link. No password to remember.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            autoFocus
            required
            aria-invalid={error ? true : undefined}
            className="h-11 text-base"
          />
          {error && (
            <p role="alert" className="text-[13px] text-caution">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={busy} className="h-11 w-full text-[15px]">
          {busy ? "Sending…" : "Send sign-in link"}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </Button>
      </form>
      <p className="text-[13px] text-ink-soft">
        New to Elapse? Use any email; we create your account when you open the link.
      </p>
    </section>
  );
}
