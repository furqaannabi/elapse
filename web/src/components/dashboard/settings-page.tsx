/**
 * `SettingsPage` — `/dashboard/settings`: profile, payout + fee,
 * checkout branding, notifications, danger zone, and a link to Activity.
 *
 * Maps to: FR-DSH-100…105.
 */
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "./page-header";
import { BrandingSection } from "./settings-branding";
import { DangerSection, NotificationsSection, PayoutSection, ProfileSection } from "./settings-sections";

export function SettingsPage() {
  return (
    <Page>
      <PageHeader
        title="Settings"
        lede="Your business, where money lands, and how the checkout looks."
        actions={
          <Link href="/dashboard/settings/activity" className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
            Activity log
            <ArrowRight data-icon="inline-end" className="size-3.5" />
          </Link>
        }
      />
      <div className="mt-8">
        <ProfileSection />
        <PayoutSection />
        <BrandingSection />
        <NotificationsSection />
        <DangerSection />
      </div>
    </Page>
  );
}
