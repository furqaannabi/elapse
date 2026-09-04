/**
 * `SubscriptionsLayout` — split structure for Subscriptions.
 */
"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { SplitLayout } from "./split-layout";
import { SubscriptionsList } from "./subscriptions-list";

export function SubscriptionsLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <SplitLayout list={<SubscriptionsList />} detail={children} hasDetail={segment !== null} backHref="/dashboard/subscriptions" backLabel="Subscriptions" />;
}
