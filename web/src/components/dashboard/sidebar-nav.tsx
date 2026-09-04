/**
 * `SidebarNav` — the section list shared by the desktop sidebar and the
 * mobile bottom sheet. Active item is marked by weight, a muted fill, and
 * a 2px ink bar at the left edge; never colour alone.
 *
 * Maps to: FR-DSH-001.
 */
"use client";

import Link from "next/link";
import { NAV, activeItem, isActive } from "./nav";
import { cn } from "@/lib/utils";

export function SidebarNav({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const active = activeItem(pathname);
  return (
    <nav aria-label="Dashboard" className={cn("flex flex-col gap-0.5", className)}>
      {NAV.map((item) => {
        const Icon = item.icon;
        const current = item.children
          ? active?.parent?.label === item.label
          : isActive(item.href, pathname, item.exact);
        return (
          <div key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={current && !item.children ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:h-8",
                current
                  ? "bg-muted font-medium text-foreground"
                  : "text-ink-soft hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {current && (
                <span aria-hidden className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-foreground" />
              )}
              {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.75} />}
              <span>{item.label}</span>
            </Link>
            {item.children && current && (
              <div className="mt-0.5 mb-1 ml-[1.6rem] flex flex-col gap-0.5 border-l border-border pl-3">
                {item.children.map((child) => {
                  const childCurrent = isActive(child.href, pathname, false);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={childCurrent ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center rounded-lg px-2 text-[14px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:h-7 lg:text-[13px]",
                        childCurrent
                          ? "font-medium text-foreground"
                          : "text-ink-soft hover:text-foreground",
                      )}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
