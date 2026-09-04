/**
 * Navigation model for the dashboard sidebar.
 *
 * FR-DSH-001: eight sections, Developers with three children; the active
 * item follows the route.
 */
import { describe, expect, it } from "vitest";
import { NAV, activeItem, isActive } from "./nav";

describe("dashboard nav (FR-DSH-001)", () => {
  it("lists the eight sections in the signed order", () => {
    expect(NAV.map((n) => n.label)).toEqual([
      "Home",
      "Products",
      "Subscriptions",
      "Customers",
      "Invoices",
      "Balance & payouts",
      "Developers",
      "Settings",
    ]);
  });

  it("nests Keys, Webhooks, Events under Developers", () => {
    const dev = NAV.find((n) => n.label === "Developers")!;
    expect(dev.children?.map((c) => c.label)).toEqual(["Keys", "Webhooks", "Events"]);
  });

  it("marks Home active only on /dashboard exactly", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/dashboard", "/dashboard/products")).toBe(false);
  });

  it("marks a section active on its detail routes", () => {
    expect(isActive("/dashboard/subscriptions", "/dashboard/subscriptions/sub_8f2k")).toBe(true);
    expect(isActive("/dashboard/developers/webhooks", "/dashboard/developers/webhooks/wh_1")).toBe(true);
    expect(isActive("/dashboard/developers/keys", "/dashboard/developers/webhooks/wh_1")).toBe(false);
  });

  it("resolves the active item and its parent for a pathname", () => {
    const a = activeItem("/dashboard/developers/events/evt_1");
    expect(a?.item.label).toBe("Events");
    expect(a?.parent?.label).toBe("Developers");
    expect(activeItem("/dashboard/settings/activity")?.item.label).toBe("Settings");
    expect(activeItem("/dashboard")?.item.label).toBe("Home");
  });
});
