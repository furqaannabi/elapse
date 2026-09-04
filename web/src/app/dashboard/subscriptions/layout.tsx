/**
 * `/dashboard/subscriptions` — split list + detail. FR-DSH-040…044.
 */
import { SubscriptionsLayout } from "@/components/dashboard/subscriptions-layout";

export default function DashboardSubscriptionsLayout({ children }: { children: React.ReactNode }) {
  return <SubscriptionsLayout>{children}</SubscriptionsLayout>;
}
