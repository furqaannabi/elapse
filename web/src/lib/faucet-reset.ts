/**
 * When a faucet limit eases, in words: "14:32", or "tomorrow at 14:32" when it eases after midnight —
 * the faucet's windows are 24 hours. Shared by the checkout's Add funds step (FR-CHK-041) and the
 * dashboard's Get test AUSD card (FR-DSH-145).
 *
 * @param resetsAt Unix seconds from the API's `resets_at`, or null when the limit does not ease with time.
 */
export function faucetResetTime(resetsAt: number | null): string {
  if (resetsAt === null) return "a while";
  const at = new Date(resetsAt * 1000);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `tomorrow at ${time}`;
}
