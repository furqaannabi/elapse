/**
 * Delivery status words and chip tones, shared by the log and the drawer.
 * Status is always a word (BR-DSH-003).
 */
import type { Delivery } from "@/lib/dashboard/types";
import type { ChipTone } from "./status-chip";

export const DELIVERY_TONE: Record<Delivery["status"], ChipTone> = {
  pending: "caution",
  succeeded: "neutral",
  failed: "caution",
  exhausted: "destructive",
  skipped: "muted",
};

export function deliveryWord(d: Pick<Delivery, "status">): string {
  return d.status[0]!.toUpperCase() + d.status.slice(1);
}
