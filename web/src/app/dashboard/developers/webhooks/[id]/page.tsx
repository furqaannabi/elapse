/**
 * `/dashboard/developers/webhooks/[id]` — endpoint detail and delivery
 * log. FR-DSH-082…085.
 */
import { EndpointDetail } from "@/components/dashboard/endpoint-detail";

export default async function DeveloperWebhookDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EndpointDetail endpointId={id} />;
}
