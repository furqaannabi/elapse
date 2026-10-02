/**
 * `LoginForm` — email in, magic link out.
 *
 * Idle: one field, one button. Sent: "Check your inbox" naming the address,
 * with Resend limited to once per 30 s. When the API returns the token it
 * would have emailed (the mock does), a clearly-labelled development link
 * lets you follow it without an inbox.
 *
 * When the API offers it, "Try the demo account" sits under the form — or above it, as the primary
 * action, at `/login?demo=1` (FR-DSH-146).
 *
 * Maps to: FR-DSH-010, FR-DSH-146.
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldHint } from "@/components/ui/field-hint";
import { check, rules } from "@/lib/forms/rules";
import { getDashboardApi } from "@/lib/dashboard/client";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import { cn } from "@/lib/utils";
import { DemoSignIn } from "./demo-sign-in";

export const RESEND_COOLDOWN_S = 30;

export function LoginForm({ api: injected }: { api?: DashboardApi }) {
  const api = injected ?? getDashboardApi();
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  // FR-DSH-146: the demo account is offered only when the API says it can be reached.
  const [demoOn, setDemoOn] = useState(false);
  const demoFirst = params.get("demo") === "1";
  useEffect(() => {
    let live = true;
    void api.demoAvailable().then((on) => live && setDemoOn(on));
    return () => {
      live = false;
    };
  }, [api]);
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

  // FR-DSH-114: the same email rule the API applies (one @, a dot after it, ≤ 254), shown as typed.
  const problem = check(rules.email, email);
  const send = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestMagicLink(email.trim());
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

  const demo = demoOn ? <DemoSignIn signInDemo={(pin) => api.signInDemo(pin)} onSignedIn={() => router.replace("/dashboard")} prominent={demoFirst} /> : null;

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
      {demoFirst && demo && (
        <>
          {demo}
          <p className="placard text-center">or sign in with your email</p>
        </>
      )}
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
            maxLength={rules.email.maxLength}
            aria-invalid={error || (email.trim() && problem) ? true : undefined}
            aria-describedby="email-hint"
            className="h-11 text-base"
          />
          <FieldHint id="email-hint" error={error ?? (email.trim() ? problem : null)} />
        </div>
        <Button type="submit" size="lg" variant={demoFirst && demo ? "outline" : "default"} disabled={busy || problem !== null} className="h-11 w-full text-[15px]">
          {busy ? "Sending…" : "Send sign-in link"}
          <ArrowRight data-icon="inline-end" className="size-4" />
        </Button>
      </form>
      <p className="text-[13px] text-ink-soft">
        New to Elapse? Use any email; we create your account when you open the link.
      </p>
      {!demoFirst && demo && (
        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <p className="text-[13px] text-ink-soft">Just looking? A shared demo account is filled with real testnet meters.</p>
          {demo}
        </div>
      )}
    </section>
  );
}
