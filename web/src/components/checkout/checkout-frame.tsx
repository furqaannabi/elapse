/**
 * `CheckoutFrame` — the hosted page's chrome: merchant identity at the
 * top, "Powered by Elapse" with a lock at the bottom, one narrow column.
 *
 * Merchant branding (FR-CHK-014) is applied here: the accent overrides
 * `--live` and `--pen` for everything inside, so the meter and the primary
 * actions take the merchant's colour while layout and copy stay ours. The
 * footer is also the judge-mode gesture target (triple tap, FR-CHK-011).
 */
"use client";

import { Lock } from "lucide-react";
import { useRef } from "react";
import { Logo } from "@/components/site/logo";
import type { Branding } from "@/lib/checkout/types";
import { cn } from "@/lib/utils";

export function CheckoutFrame({
  merchant,
  children,
  onJudgeGesture,
  className,
}: {
  merchant: Branding;
  children: React.ReactNode;
  onJudgeGesture?: () => void;
  className?: string;
}) {
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 900), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      onJudgeGesture?.();
    }
  };

  const accentStyle = merchant.accent
    ? ({ "--live": merchant.accent, "--pen": merchant.accent } as React.CSSProperties)
    : undefined;

  return (
    <div
      style={accentStyle}
      className={cn("flex min-h-dvh flex-col bg-background text-foreground", className)}
    >
      <header className="mx-auto flex w-full max-w-[440px] items-center gap-3 px-5 pt-6 pb-2">
        <MerchantMark merchant={merchant} />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">{merchant.name}</span>
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-6">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[440px] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={tap}
          aria-label="Powered by Elapse"
          className="flex w-full items-center justify-center gap-2 py-3 text-xs text-ink-soft outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md"
        >
          <Lock className="size-3.5" aria-hidden />
          <span>Powered by</span>
          <Logo size={14} className="text-foreground/80 [&>span]:text-[0.8rem]" />
          {merchant.supportUrl && (
            <>
              <span aria-hidden>·</span>
              <a
                href={merchant.supportUrl}
                onClick={(e) => e.stopPropagation()}
                className="!text-ink-soft underline-offset-3 hover:!text-foreground"
              >
                Support
              </a>
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

/** Merchant logo, or a lettermark when none is set. */
function MerchantMark({ merchant }: { merchant: Branding }) {
  if (merchant.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={merchant.logoUrl}
        alt=""
        width={28}
        height={28}
        className="size-7 rounded-md object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-md bg-live text-[13px] font-bold text-primary-foreground"
      style={{ color: "#0a0a0a" }}
    >
      {merchant.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
