/**
 * FR-EXM-035: the line under the meter while Acme makes up its mind. Kept out of the view so it
 * tests without a browser, like the Lambda console's `flow.ts`.
 *
 * `<Meter>` re-reads its session every 5 s, so an approved pause shows there several seconds after
 * Acme approved it. That gap is the merchant's to fill, not the SDK's — this is where a reader's
 * own UI would go.
 */

/** What Acme was asked for, and the one line the page shows about it. */
export interface AskState {
  /** The state the subscriber is waiting for, or `null` once nothing is pending. */
  want: "pause" | "resume" | null;
  line: string;
}

const verb = { pause: "pausing", resume: "resuming" } as const;

/**
 * Asks Acme (FR-EXM-033), reporting each step to the page. Never throws: a subscriber who clicked
 * Pause must always be told something.
 */
export async function ask(
  fetchFn: typeof fetch,
  want: "pause" | "resume",
  session: string,
  onState: (s: AskState) => void,
): Promise<void> {
  onState({ want, line: `Asked Acme to ${want}…` });
  try {
    const res = await fetchFn(`/${want}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
    });
    // 202 only: Acme has called subscriptions.pause, but nothing is true until the chain says so.
    if (res.status === 202) return onState({ want, line: `Acme approved · ${verb[want]}` });
  } catch {
    // Fall through: the subscriber does not care which half of the round trip failed.
  }
  onState({ want: null, line: `Acme could not ${want} that meter.` });
}

/** True once the meter itself shows what was asked for, which is when the line has done its job. */
export function clearWhen(s: AskState, view: string): boolean {
  if (s.want === "pause") return view === "paused";
  if (s.want === "resume") return view === "running";
  return false;
}
