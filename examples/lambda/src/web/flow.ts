/**
 * FR-EXM-114/125/152: the console's brain, kept out of the view so it tests without a browser.
 *
 * The console never navigates anywhere. A Run with no session comes back 409 with a checkout
 * session id, which the page authorises in place with `<Authorize>`; the subscription id then
 * arrives from the `checkout.session.completed` webhook, via this server's `/session/:cs`.
 */

export interface RunBody {
  ok?: boolean;
  result?: unknown;
  error?: string;
  ms?: number;
  logs?: string[];
}

export type RunOutcome =
  | { k: "needs_auth"; session: string }
  | { k: "result"; body: RunBody }
  | { k: "error"; message: string };

/** POST /run for this subscription, or `null` when there is no session yet. */
export async function postRun(fetchFn: typeof fetch, sub: string | null, code: string): Promise<RunOutcome> {
  try {
    const res = await fetchFn(`/run?sub=${sub ?? "none"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await res.json()) as RunBody & { needs_start?: boolean; session?: string };
    if (res.status === 409 && body.session) return { k: "needs_auth", session: body.session };
    if (!res.ok) return { k: "error", message: body.error ?? `request failed (${res.status})` };
    return { k: "result", body };
  } catch (err) {
    return { k: "error", message: (err as Error).message };
  }
}

/**
 * Which Subscription a checkout session became. The link is written by the webhook, so this polls
 * for a moment rather than assuming it has already landed, and gives up rather than spinning.
 */
export async function resolveSub(
  fetchFn: typeof fetch,
  session: string,
  o: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const attempts = o.attempts ?? 40;
  const delayMs = o.delayMs ?? 500;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchFn(`/session/${session}`);
      if (res.ok) return ((await res.json()) as { sub: string }).sub;
    } catch {
      // the server may be restarting; try again until the attempts run out
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}
