/**
 * `SiteFooter` — closes the landing with the real links and the single
 * permitted chain mention on the marketing site ("Built on Monad").
 */
import Link from "next/link";
import { Logo } from "./logo";
import { links } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 px-5 py-12 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-[36ch] text-sm text-ink-soft">
            Per-second subscriptions. You only pay what elapsed.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a href={links.docs} className="text-ink-soft hover:text-foreground">
            Docs
          </a>
          <a href={links.github} className="text-ink-soft hover:text-foreground">
            GitHub
          </a>
          <Link href={links.dashboard} className="text-ink-soft hover:text-foreground">
            Dashboard
          </Link>
          <a href={links.status} className="text-ink-soft hover:text-foreground">
            Status
          </a>
          <a href={links.x} className="text-ink-soft hover:text-foreground">
            X
          </a>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-4 md:px-8">
          <span className="placard">© {year} Elapse</span>
          <span className="placard">Built on Monad</span>
        </div>
      </div>
    </footer>
  );
}
