/**
 * `EventsLayout` — wires the split structure for Events: the list on the
 * left, the routed detail (`[id]`) on the right.
 */
"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { EventsList } from "./events-list";
import { SplitLayout } from "./split-layout";

export function EventsLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return (
    <SplitLayout
      list={<EventsList />}
      detail={children}
      hasDetail={segment !== null}
      backHref="/dashboard/developers/events"
      backLabel="Events"
    />
  );
}
