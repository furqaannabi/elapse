/**
 * Relayer sends survive a nonce collision (FR-API-157, ADR 2026-10-03).
 *
 * viem asks the RPC for the pending nonce on every send. Monad's RPC can lag behind a transaction
 * it has just accepted, and the API and the worker sign with the same relayer key from two
 * processes, so two sends can be signed with one nonce; the RPC refuses the second ("An existing
 * transaction had higher priority"). A refused send never entered the mempool, so sending it again
 * — with a nonce fetched afresh, which every `writeContract` does — cannot double-send.
 *
 * Only a refusal that names a nonce clash is resent. Anything else surfaces at once: a send the RPC
 * accepted, or one whose fate is unknown, is never sent twice.
 */

/** The RPC's words for "that nonce is taken", wherever in the error chain they appear. */
const CLASH = [/existing transaction had higher priority/i, /nonce too low/i, /replacement transaction underpriced/i];

/** Waits before the second, third and fourth tries; the fourth refusal surfaces. */
export const RESEND_DELAYS_MS = [600, 1200, 1800] as const;

/** Whether an error (or anything in its `cause` chain) is the RPC refusing a nonce already taken. */
export function isNonceClash(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 8; depth += 1) {
    const o = e as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    const text = [o.message, o.details, o.shortMessage].filter((t): t is string => typeof t === "string").join(" ");
    if (CLASH.some((re) => re.test(text))) return true;
    e = o.cause;
  }
  return false;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `send`, and runs it again after each nonce clash, up to four tries in all.
 * @param call The contract function, for the log line — never the transaction, its data or a signature.
 */
export async function sendWithResend<T>(
  call: string,
  send: () => Promise<T>,
  o: { sleep?: (ms: number) => Promise<void>; log?: (e: Record<string, unknown>) => void } = {},
): Promise<T> {
  const sleep = o.sleep ?? realSleep;
  const log = o.log ?? ((e) => console.warn("relayer_nonce_clash", e));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (err) {
      const wait = RESEND_DELAYS_MS[attempt];
      if (wait === undefined || !isNonceClash(err)) throw err;
      log({ msg: "relayer nonce clash, resending", call, attempt: attempt + 2, wait_ms: wait });
      await sleep(wait);
    }
  }
}
