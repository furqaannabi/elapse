/**
 * Where the Elapse popup may send its result, and exactly what it sends (checkout FR-CHK-038,
 * API FR-API-140(d), React BR-RCT-004).
 *
 * The popup posts to one origin only: the origin of the session's `success_url`, which the merchant
 * set on its server. `postMessage`'s target origin makes the browser drop the message if the opener
 * is anywhere else. Plain `http` is accepted only for `localhost` in test mode, so a live session can
 * never hand a transaction hash to an unencrypted page. The message carries the step, the subscription
 * id, the transaction hash and the nonce: never a signature, identity token or key.
 */

export type ResultStep = "authorised" | "stopped" | "paused" | "resumed";

export function resultTargetOrigin(successUrl: string, o: { livemode: boolean }): string | null {
  let u: URL;
  try {
    u = new URL(successUrl);
  } catch {
    return null;
  }
  if (u.protocol === "https:") return u.origin;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol === "http:" && local && !o.livemode) return u.origin;
  return null;
}

/** Posts the result to the opener at the session's trusted origin. Returns false when nothing was sent. */
export function postResult(o: {
  opener: { postMessage(message: unknown, targetOrigin: string): void } | null;
  successUrl: string;
  livemode: boolean;
  step: ResultStep;
  subscription: string;
  txHash: string;
  nonce: string;
}): boolean {
  const target = resultTargetOrigin(o.successUrl, { livemode: o.livemode });
  if (!o.opener || !target) return false;
  o.opener.postMessage({ type: "elapse:result", step: o.step, subscription: o.subscription, txHash: o.txHash, nonce: o.nonce }, target);
  return true;
}
