/**
 * `AccountFrame` — the chrome for `/account`. Elapse-branded, not merchant
 * branded: the page spans merchants, so it cannot honestly wear one
 * merchant's colours (ADR 2026-09-04, account page cross-merchant).
 *
 * Same column as the checkout on a phone and on a tablet. From `lg` it
 * widens to exactly two of those columns, so a subscriber with several
 * meters sees more of them at once and every card keeps the width it was
 * designed at — narrower cells truncate the figures (FR-CHK-024).
 */
import { Lock } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { cn } from "@/lib/utils";

export function AccountFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-dvh flex-col bg-background text-foreground", className)}>
      <header className="mx-auto flex w-full max-w-[440px] items-center gap-3 px-5 pt-6 pb-2 lg:max-w-[888px]">
        <Logo size={16} />
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pt-3 pb-6 lg:max-w-[888px]">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[440px] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:max-w-[888px]">
        <p className="flex items-center justify-center gap-2 py-3 text-xs text-ink-soft">
          <Lock className="size-3.5" aria-hidden />
          <span>Only you can see this page.</span>
        </p>
      </footer>
    </div>
  );
}

/** The merchant's mark beside their name, or a lettermark when none is set. */
export function MerchantMark({
  name,
  logoUrl,
  size = 28,
}: {
  name: string;
  logoUrl?: string;
  size?: number;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" width={size} height={size} className="rounded-md object-cover" />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, color: "#0a0a0a" }}
      className="grid shrink-0 place-items-center rounded-md bg-live text-[13px] font-bold"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
