/**
 * Small display helpers for the dashboard: relative time, short ids,
 * event-type words. No money here; money goes through `lib/meter/math`.
 */

/** "just now", "4 min ago", "3 h ago", "2 d ago", else a short date. */
export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** `sub_t00a1` → `sub_…00a1` when long; short ids pass through. */
export function shortId(id: string, keep = 6): string {
  const i = id.indexOf("_");
  const body = i >= 0 ? id.slice(i + 1) : id;
  if (body.length <= keep + 2) return id;
  return `${i >= 0 ? id.slice(0, i + 1) : ""}…${body.slice(-keep)}`;
}

/** `0x9a3f…7a3f` for tx hashes and addresses. */
export function shortHex(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/** Local date and time, "Sep 4, 9:37 AM". */
export function when(at: number): string {
  return new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Local clock, "9:14:07 PM". */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** "23 h 59 m", "45 m", "12 s", or "now" for a duration from now until `at`. */
export function expiresIn(at: number, now: number): string {
  const s = Math.max(0, Math.floor((at - now) / 1000));
  if (s === 0) return "now";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} m`;
}
