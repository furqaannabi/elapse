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
  // region:verify
  let event;
  try {
    event = constructEvent(rawBody, signature, deps.secret);
  } catch (err) {
    deps.log(`✗ rejected: ${(err as Error).message}`);
    return { status: 400, body: JSON.stringify({ error: "invalid signature" }) };
  }
  // endregion
  // region:handle
  return {
    status: 200,
    body: JSON.stringify({ received: true }),
    work: () => {
      const action = deps.entitlements.first(event.id) ? deps.entitlements.apply(event) : null;
      deps.log(action === null ? `↺ duplicate ${event.id}` : `${event.id}  ${event.type.padEnd(24)}→ ${action}`);
      if (action !== null && deps.logJson !== false) deps.log(JSON.stringify(event, null, 2));
    },
  };
  // endregion
}
