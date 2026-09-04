import { EventDetail } from "@/components/dashboard/event-detail";

export default async function DeveloperEventDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetail eventId={id} />;
}
