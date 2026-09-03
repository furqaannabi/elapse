/**
 * `SiteHeader` — top bar for the marketing site.
 *
 * Wordmark left, three links and the theme toggle right. Sticky with a
 * paper-tinted backdrop so the strip can scroll beneath it.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { links } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-paper/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="Elapse home" className="text-foreground">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          <a
            href={links.docs}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "hidden h-9 px-3 text-sm text-ink-soft hover:text-foreground sm:inline-flex",
            )}
          >
            Docs
          </a>
          <a
            href={links.github}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "hidden h-9 px-3 text-sm text-ink-soft hover:text-foreground sm:inline-flex",
            )}
          >
            GitHub
          </a>
          <Link
            href={links.dashboard}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-9 px-3 text-sm",
            )}
          >
            Dashboard
            <ArrowUpRight data-icon="inline-end" className="size-3.5" />
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
