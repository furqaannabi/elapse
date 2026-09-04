import { SubscriptionDetail } from "@/components/dashboard/subscription-detail";

export default async function DashboardSubscriptionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscriptionDetail subscriptionId={id} />;
}
