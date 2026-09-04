/**
 * `/dashboard/developers/events` — split list + detail. FR-DSH-090/091.
 */
import { EventsLayout } from "@/components/dashboard/events-layout";

export default function DeveloperEventsLayout({ children }: { children: React.ReactNode }) {
  return <EventsLayout>{children}</EventsLayout>;
}
