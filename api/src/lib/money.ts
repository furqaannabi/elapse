/**
 * Decimal-string money (BR-API-004, BR-MTR-001). Rates cross the wire as
 * strings like "0.004" and are converted to token base units with BigInt
 * arithmetic only. No `parseFloat`, ever.
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** `"12"`, `"0.004"`: digits, optional single point, digits. No sign, exponent, or bare point. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && DECIMAL_RE.test(s);
}

/**
 * `"0.004"` with 6 decimals → `4000n`. Returns null if the string is malformed
 * or needs more fractional digits than the token has (the rate would be
 * rounded, which BR-CON-005 forbids).
 */
export function decimalToBaseUnits(s: string, decimals: number): bigint | null {
  if (!isDecimalString(s)) return null;
  const [whole, frac = ""] = s.split(".") as [string, string?];
  const trimmed = frac.replace(/0+$/, "");
  if (trimmed.length > decimals) return null;
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

/** `4000n` with 6 decimals → `"0.004"`; trailing zeros trimmed, at least one digit before the point. */
export function baseUnitsToDecimal(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const str = abs.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, str.length - decimals);
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
