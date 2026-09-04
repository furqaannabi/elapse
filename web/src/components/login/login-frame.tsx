/**
 * `LoginFrame` — the narrow column the sign-in screens share: wordmark on
 * top, one column, quiet footer. Same width as the hosted checkout so the
 * two feel like one product.
 */
import Link from "next/link";
import { Logo } from "@/components/site/logo";

export function LoginFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-[440px] px-5 pt-8">
        <Link href="/" aria-label="Elapse home" className="inline-flex text-foreground">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 py-10">{children}</main>
      <footer className="mx-auto w-full max-w-[440px] px-5 pb-8">
        <p className="placard">Merchant dashboard</p>
      </footer>
    </div>
  );
}
