/** The six §5.1 event types. Nothing else exists (BR-API-006); never per second. */
export const EVENT_TYPES = [
  "checkout.session.completed",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "invoice.settled",
  "invoice.payment_failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(s: string): s is EventType {
  return (EVENT_TYPES as readonly string[]).includes(s);
}
