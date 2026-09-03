/**
 * `FaceIdSheet` — the mocked sign-in. Presents the same two choices the
 * Privy flow will offer (Face ID / passkey, or email) behind the
 * `AuthProvider` shape the page calls, so swapping in Privy in Week 3
 * changes the implementation, not the screen.
 *
 * Maps to: FR-CHK-002; BR-CHK-001 (no wallet words).
 */
"use client";

import { ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type AuthResult = { email?: string };

export function FaceIdSheet({
  open,
  onOpenChange,
  merchantName,
  onAuthenticated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchantName: string;
  onAuthenticated: (r: AuthResult) => void;
}) {
  const [step, setStep] = useState<"choose" | "scanning" | "email">("choose");
  const [email, setEmail] = useState("");

  // Mock Face ID: a short scan, then success.
  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => onAuthenticated({}), 1100);
    return () => clearTimeout(t);
  }, [step, onAuthenticated]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setStep("choose");
        onOpenChange(o);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-[480px] rounded-t-xl border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0 pt-4">
          <SheetTitle className="text-base">Sign in to pay {merchantName}</SheetTitle>
          <SheetDescription className="text-ink-soft">
            No account or password. Your device confirms it&rsquo;s you.
          </SheetDescription>
        </SheetHeader>

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

        {step === "email" && (
          <form
            className="flex flex-col gap-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.includes("@")) onAuthenticated({ email: email.trim() });
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
            <Button type="submit" size="lg" disabled={!email.includes("@")} className="h-12 w-full text-base">
              Continue
            </Button>
            <p className="text-center text-xs text-ink-soft">
              We&rsquo;ll send a one-time code. No password to remember.
            </p>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
