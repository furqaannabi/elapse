/**
 * `AccountFrame` — the chrome for `/account`. Elapse-branded, not merchant
 * branded: the page spans merchants, so it cannot honestly wear one
 * merchant's colours (ADR 2026-09-04, account page cross-merchant).
 *
 * Same narrow column as the checkout so the two feel like one product.
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
      <header className="mx-auto flex w-full max-w-[440px] items-center gap-3 px-5 pt-6 pb-2">
        <Logo size={16} />
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pt-3 pb-6">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[440px] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
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
