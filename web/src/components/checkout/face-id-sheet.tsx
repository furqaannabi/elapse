/**
 * `FaceIdSheet` — sign in with Face ID / passkey, or an email code. The screen is the
 * same whichever `AuthFlow` is in context: the mock (seeded sessions, tests) or Privy
 * (`PrivyCheckout`). Errors are spoken plainly; no wallet words ever (BR-CHK-001).
 *
 * Maps to: FR-CHK-002, FR-CHK-016.
 */
"use client";

import { ScanFace } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthFlow, type AuthResult } from "@/lib/checkout/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type { AuthResult };

export function FaceIdSheet({
  open,
  onOpenChange,
  merchantName,
  onAuthenticated,
  resume,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchantName: string;
  onAuthenticated: (r: AuthResult) => void;
  /** A sign-in that completed by redirect (Google): open straight on the Face ID offer. */
  resume?: AuthResult | null;
}) {
  const flow = useAuthFlow();
  // The flow object changes identity as Privy's hooks re-render; the scan must run once per step, not per render.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const [step, setStep] = useState<"choose" | "scanning" | "email" | "code" | "offer">(resume ? "offer" : flow.passkeyFirst ? "choose" : "email");
  const [result, setResult] = useState<AuthResult | null>(resume ?? null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Face ID: the device confirms the person; on failure, back to the choice with a sentence.
  useEffect(() => {
    if (step !== "scanning") return;
    let alive = true;
    flowRef.current
      .passkey()
      .then((r) => alive && onAuthenticated(r))
      .catch((e: unknown) => {
        if (!alive) return;
        setProblem(e instanceof Error && e.message ? e.message : "Face ID didn't complete. Try again or use email.");
        setStep("choose");
      });
    return () => {
      alive = false;
    };
  }, [step, onAuthenticated]);

  const submitEmail = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await flowRef.current.sendCode(email.trim());
      if (flowRef.current.usesCode) setStep("code");
      else arrive(await flowRef.current.verifyCode(email.trim(), ""));
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "We couldn't send the code. Check the address.");
    } finally {
      setBusy(false);
    }
  };

  /** After an email sign-in on a device without Face ID: offer to attach it, once. */
  const arrive = (r: AuthResult) => {
    if (flowRef.current.canLinkPasskey && !flowRef.current.passkeyFirst) {
      setResult(r);
      setStep("offer");
    } else onAuthenticated(r);
  };

  const linkFaceId = async () => {
    setBusy(true);
    try {
      await flowRef.current.linkPasskey();
    } catch {
      // Face ID is a convenience; the sign-in already happened.
    } finally {
      setBusy(false);
      onAuthenticated(result ?? {});
    }
  };

  const google = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await flowRef.current.google?.();
      // The browser is leaving for Google; nothing more happens on this page load.
    } catch (e) {
      setBusy(false);
      setProblem(e instanceof Error && e.message ? e.message : "Google sign-in didn't start. Try email instead.");
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setProblem(null);
    try {
      arrive(await flowRef.current.verifyCode(email.trim(), code.trim()));
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "That code didn't match. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setStep(flowRef.current.passkeyFirst ? "choose" : "email");
          setProblem(null);
        }
        onOpenChange(o);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-[480px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0 pt-4">
          <SheetTitle className="text-base">Sign in to pay {merchantName}</SheetTitle>
          <SheetDescription className="text-ink-soft">
            {step === "email" || step === "code"
              ? "No account or password. A code by email is all it takes."
              : step === "offer"
                ? "You're signed in."
                : "No account or password. Your device confirms it\u2019s you."}
          </SheetDescription>
        </SheetHeader>

        {problem && (
          <p className="mb-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground" role="alert">
            {problem}
          </p>
        )}

        {step === "choose" && (
          <div className="flex flex-col gap-2 pb-2">
            <Button size="lg" onClick={() => setStep("scanning")} className="h-12 w-full text-base">
              <ScanFace data-icon="inline-start" className="size-5" />
              Continue with Face ID
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setStep("email")}
              className="h-11 w-full text-ink-soft"
            >
              Use email instead
            </Button>
          </div>
        )}

        {step === "scanning" && (
          <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
            <ScanFace className="size-14 animate-pulse text-live" aria-hidden />
            <p className="text-sm text-ink-soft">Confirming with Face ID…</p>
          </div>
        )}

        {step === "email" && flow.google && (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void google()} className="mb-3 h-12 w-full text-base">
            <GoogleMark />
            {busy ? "Opening Google…" : "Continue with Google"}
          </Button>
        )}

        {step === "email" && (
          <form
            className="flex flex-col gap-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.includes("@") && !busy) void submitEmail();
            }}
          >
            <Input
              autoFocus
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
              className="h-12 text-base"
            />
            <Button type="submit" size="lg" disabled={!email.includes("@") || busy} className="h-12 w-full text-base">
              {busy ? "Sending…" : "Continue"}
            </Button>
            <p className="text-center text-xs text-ink-soft">
              We&rsquo;ll send a one-time code. No password to remember.
            </p>
            {!flow.passkeyFirst && (
              <button type="button" onClick={() => setStep("scanning")} className="py-1 text-center text-xs text-ink-soft">
                Use Face ID instead
              </button>
            )}
          </form>
        )}

        {step === "offer" && (
          <div className="flex flex-col gap-2 pb-2">
            <p className="text-sm text-ink-soft">
              Use Face ID next time? Your device confirms it&rsquo;s you, no code to type.
            </p>
            <Button size="lg" disabled={busy} onClick={() => void linkFaceId()} className="h-12 w-full text-base">
              <ScanFace data-icon="inline-start" className="size-5" />
              {busy ? "Setting up…" : "Turn on Face ID"}
            </Button>
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => onAuthenticated(result ?? {})} className="h-11 w-full text-ink-soft">
              Not now
            </Button>
          </div>
        )}

        {step === "code" && (
          <form
            className="flex flex-col gap-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().length >= 6 && !busy) void submitCode();
            }}
          >
            <p className="text-sm text-ink-soft">Enter the code we sent to {email.trim()}.</p>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="One-time code"
              className="h-12 text-base tracking-widest"
            />
            <Button type="submit" size="lg" disabled={code.trim().length < 6 || busy} className="h-12 w-full text-base">
              {busy ? "Checking…" : "Continue"}
            </Button>
            <button type="button" onClick={() => setStep("email")} className="py-1 text-center text-xs text-ink-soft">
              Use a different email
            </button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Google's "G", inline so the sheet needs no image request. */
function GoogleMark() {
  return (
    <svg data-icon="inline-start" className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-5 6.7-5z" />
    </svg>
  );
}
