/**
 * `DashboardShell` — the merchant dashboard's chrome.
 *
 * Desktop (`lg`+): a 232px sidebar with the wordmark and the section list,
 * a 56px top bar, the test-mode banner, then the page. Below `lg` the
 * sidebar becomes a bottom sheet opened from a menu button in the top bar.
 * Everything inherits the Strip-Chart world: hairlines, tonal steps, no
 * shadows on the page, one accent (amber) reserved for what is live.
 *
 * Maps to: FR-DSH-001, FR-DSH-002, FR-DSH-003, FR-DSH-009.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BookOpen, Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/site/theme-toggle";
import type { Merchant } from "@/lib/dashboard/types";
import { links } from "@/lib/site";
import { cn } from "@/lib/utils";
import { useMerchantOptional } from "./merchant-context";
import { ModeBanner } from "./mode-banner";
import { NotificationsBell } from "./notifications-bell";
import { SearchBox } from "./search-box";
import { ModeToggle } from "./mode-toggle";
import { SidebarNav } from "./sidebar-nav";

export function DashboardShell({
  merchant,
  onSignOut,
  children,
}: {
  merchant: Merchant;
  onSignOut?: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const session = useMerchantOptional();
  const api = session?.api ?? null;

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border lg:flex">
        <div className="flex h-14 items-center px-4">
          <Link href="/" aria-label="Elapse home" className="text-foreground">
            <Logo />
          </Link>
        </div>
        <SidebarNav pathname={pathname} className="px-2" />
        <div className="mt-auto flex items-center justify-between px-4 py-3">
          <a
            href={links.docs}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 px-2 text-[13px] text-ink-soft hover:text-foreground",
            )}
          >
            <BookOpen data-icon="inline-start" className="size-3.5" />
            Docs
          </a>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          role="banner"
          className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/70 bg-paper/85 px-3 backdrop-blur-sm md:px-6"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
            className="size-11 text-ink-soft hover:text-foreground lg:hidden"
          >
            <Menu className="size-5" />
          </Button>
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {merchant.name ?? merchant.email}
          </span>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <ModeToggle />
            <SearchBox api={api} className="hidden md:block" />
            <NotificationsBell api={api} />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Account menu"
                    className="size-8 rounded-full text-[12px] font-semibold uppercase"
                  />
                }
              >
                {(merchant.name ?? merchant.email).slice(0, 1)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate font-normal text-ink-soft">
                    {merchant.email}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/dashboard/settings" />}>Settings</DropdownMenuItem>
                <DropdownMenuItem render={<a href={links.docs} />}>Docs</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <ModeBanner />

        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>

      <Toaster position="bottom-right" />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-lg pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>
              <Logo />
            </SheetTitle>
          </SheetHeader>
          <SearchBox api={api} size="lg" onNavigate={() => setMenuOpen(false)} className="mx-4" />
          <SidebarNav pathname={pathname} onNavigate={() => setMenuOpen(false)} className="px-2" />
          <div className="flex items-center justify-between border-t border-border px-4 pt-3">
            <a href={links.docs} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-10 text-ink-soft")}>
              <BookOpen data-icon="inline-start" className="size-3.5" />
              Docs
            </a>
            <ThemeToggle />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
