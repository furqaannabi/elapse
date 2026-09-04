/**
 * The dashboard's navigation model: sections, routes, icons, and the
 * active-route rule. Pure data so the sidebar, the mobile sheet, and the
 * breadcrumb share one truth.
 *
 * Maps to: FR-DSH-001; design brief 3 "Shell".
 */
import {
  Boxes,
  Code2,
  FileText,
  Home,
  Landmark,
  Settings,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Home matches its route exactly; every other item matches by prefix. */
  exact?: boolean;
  children?: NavItem[];
};

export const NAV: readonly NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home, exact: true },
  { label: "Products", href: "/dashboard/products", icon: Boxes },
  { label: "Subscriptions", href: "/dashboard/subscriptions", icon: Timer },
  { label: "Customers", href: "/dashboard/customers", icon: Users },
  { label: "Invoices", href: "/dashboard/invoices", icon: FileText },
  { label: "Balance & payouts", href: "/dashboard/balance", icon: Landmark },
  {
    label: "Developers",
    href: "/dashboard/developers/keys",
    icon: Code2,
    children: [
      { label: "Keys", href: "/dashboard/developers/keys" },
      { label: "Webhooks", href: "/dashboard/developers/webhooks" },
      { label: "Events", href: "/dashboard/developers/events" },
    ],
  },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function isActive(href: string, pathname: string, exact = href === "/dashboard"): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/** The deepest matching item and, when nested, its parent. */
export function activeItem(pathname: string): { item: NavItem; parent?: NavItem } | null {
  for (const item of NAV) {
    const child = item.children?.find((c) => isActive(c.href, pathname, false));
    if (child) return { item: child, parent: item };
  }
  const top = NAV.find((item) =>
    item.children
      ? pathname.startsWith("/dashboard/developers")
      : isActive(item.href, pathname, item.exact),
  );
  return top ? { item: top } : null;
}
