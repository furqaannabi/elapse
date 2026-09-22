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

/** What a poll of `/access` tells the console to do (FR-EXM-111/154). */
export type SessionSignal = "running" | "paused" | "ended" | "ignore";

/**
 * Read one `/access` answer. A session can end without this page doing anything — the merchant's
 * dashboard, the idle sweep, or a `sk_` call from anywhere — and the `subscription.canceled`
 * webhook closes it on the server before `<Meter>` notices. The console has to follow the server
 * rather than only its own component, or it goes on offering to end a session that is already
 * settled.
 *
 * Anything unrecognised is `ignore`, never `ended`: a failed poll or a restarting server must not
 * be able to tell a subscriber their meter stopped when it did not.
 */
export function readAccess(body: { active?: boolean; reason?: string } | null): SessionSignal {
  switch (body?.reason) {
    case "ended":
      return "ended";
    case "paused":
      return "paused";
    case "running":
      return "running";
    default:
      return "ignore";
  }
}

export type ClaimOutcome =
  /** Northwind has the session; the stashed Run can go. */
  | { k: "ready" }
  /** Spent, or none — render `<Authorize>` for a new one. */
  | { k: "needs_auth" }
  /** Northwind would not believe the claim. Say so; never authorise a second meter. */
  | { k: "refused"; message: string };

/**
 * FR-EXM-157: hand Northwind the `sub_` that `<Authorize>` just produced, so the console does not
 * depend on `subscription.created` having been delivered. A refusal is its own outcome and must
 * never be read as "no session yet" — that is the path that charges a subscriber twice.
 */
export async function postClaim(fetchFn: typeof fetch, sub: string): Promise<ClaimOutcome> {
  try {
    const res = await fetchFn(`/claim?sub=${sub}`, { method: "POST" });
    const body = (await res.json()) as { state?: string; error?: string; needs_start?: boolean };
    if (res.ok) return { k: "ready" };
    if (res.status === 409) return { k: "needs_auth" };
    return { k: "refused", message: body.error ?? `Northwind could not confirm that session (${res.status}).` };
  } catch (err) {
    return { k: "refused", message: (err as Error).message };
  }
}
