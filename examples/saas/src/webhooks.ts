import { constructEvent } from "@elapse/sdk";
import type { Entitlements } from "./entitlements";

/**
 * FR-EXM-020–025: the whole webhook handler. Verify first, respond 200 fast,
 * then do the merchant's work. The docs Quickstart shows the two regions.
 */

export interface WebhookDeps {
  secret: string;
  entitlements: Entitlements;
  log: (line: string) => void;
  /** Print the event body after the header line (FR-EXM-024). Default true. */
  logJson?: boolean;
}

export interface WebhookResponse {
  status: 200 | 400;
  body: string;
  /** Merchant work to run after the response is sent (BR-EXM-003). */
  work?: () => void;
}

export function handleWebhook(rawBody: string, signature: string | undefined, deps: WebhookDeps): WebhookResponse {
  const { secret, entitlements, log } = deps;
  // region:verify
  let event;
  try {
    event = constructEvent(rawBody, signature, secret);
  } catch (err) {
    log(`✗ rejected: ${(err as Error).message}`);
    return { status: 400, body: JSON.stringify({ error: "invalid signature" }) };
  }
  // endregion
  // region:handle
  return {
    status: 200,
    body: JSON.stringify({ received: true }),
    work: () => {
      if (!entitlements.first(event.id)) return log(`↺ duplicate ${event.id}`);
      const action = entitlements.apply(event);
      log(`${event.id}  ${event.type.padEnd(24)}→ ${action}`);
      if (deps.logJson !== false) log(JSON.stringify(event, null, 2));
    },
  };
  // endregion
}
