/**
 * FR-RCT-046: what the subscriber sees while the merchant decides.
 *
 * A subscriber cannot pause their own meter ([ADR 2026-09-20]) — they ask the merchant, who holds
 * the key and makes the call. The ask travels over the merchant's own wire, so the meter cannot
 * poll for an answer; what it can do is say who was asked and what they said. This lives outside
 * the component so the four transitions test without a DOM.
 *
 * The line never mentions Elapse, a transaction or a chain (BR-RCT-001). The decision was the
 * merchant's, so the merchant's name is the one the subscriber reads.
 */

export interface AskState {
  /** The state the subscriber is waiting for, or `null` once nothing is pending. */
  want: "pause" | "resume" | null;
  /** True while the merchant's handler has not answered; the control stays disabled. */
  pending: boolean;
  line: string;
}

const verb = { pause: "pausing", resume: "resuming" } as const;

/**
 * Runs the merchant's handler, reporting each step. Never throws: a subscriber who pressed Pause
 * must always be told something, including when the merchant's own code threw.
 */
export async function ask(
  want: "pause" | "resume",
  merchant: string,
  handler: () => void | Promise<void>,
  onState: (s: AskState) => void,
): Promise<void> {
  onState({ want, pending: true, line: `Asked ${merchant} to ${want}…` });
  try {
    await handler();
  } catch {
    // Whatever went wrong is the merchant's to log; the subscriber gets one plain sentence.
    return onState({ want: null, pending: false, line: `${merchant} could not ${want} that meter.` });
  }
  onState({ want, pending: false, line: `${merchant} approved · ${verb[want]}` });
}

/**
 * True once the meter itself shows what was asked for. Until then the line stands: the session is
 * re-read every 5 s, so an approved pause is visible here for seconds before the meter agrees.
 */
export function clearWhen(s: AskState, view: string): boolean {
  if (s.want === "pause") return view === "paused";
  if (s.want === "resume") return view === "running";
  return false;
}
