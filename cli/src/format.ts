/** Terminal output helpers. `NO_COLOR` and `--json` turn colour off (FR-CLI-023). */

export interface Paint {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
}

const ESC = "\u001b[";

export function paint(color: boolean): Paint {
  const wrap = (open: string) => (s: string) => (color ? `${ESC}${open}m${s}${ESC}0m` : s);
  return { bold: wrap("1"), dim: wrap("2"), red: wrap("31"), green: wrap("32"), yellow: wrap("33") };
}

export function useColor(env: NodeJS.ProcessEnv = process.env, isTTY = process.stdout.isTTY === true): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return isTTY;
}

export function clock(d = new Date()): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** `evt_1S2a…`: first 8 chars plus an ellipsis, as in the docs' example session. */
export function shortId(id: string): string {
  return id.length > 9 ? `${id.slice(0, 8)}…` : id;
}

export function prettyJson(raw: string, compact: boolean): string {
  try {
    const v = JSON.parse(raw);
    return compact ? JSON.stringify(v) : JSON.stringify(v, null, 2);
  } catch {
    return raw;
  }
}

/** Never print a secret key (BR-CLI-002). */
export function redact(s: string): string {
  return s.replace(/sk_(test|live)_[0-9A-Za-z]+/g, (m) => `${m.slice(0, 8)}…${m.slice(-4)}`);
}

/** A fixed-width table for `events list`. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
