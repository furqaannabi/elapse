/**
 * One idempotency key per user action. Generated when the action starts
 * and reused if the same request is retried, so a double click or a retry
 * after a timeout can never create a second key, product, or checkout link.
 *
 * Maps to: FR-DSH-112; BR-DSH-014.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `idem_${crypto.randomUUID()}`;
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
