import { createHmac, timingSafeEqual } from "node:crypto";
import { ElapseSignatureVerificationError } from "./errors";
import type { ElapseEvent } from "./events";

/** FR-SDK-022: test hooks. Defaults: 300 s tolerance, wall clock. */
export interface ConstructEventOptions {
  /** Seconds. `Infinity` disables the age check (tests only). */
  tolerance?: number;
  /** Unix seconds. */
  now?: () => number;
}

const DEFAULT_TOLERANCE_S = 300;
const MAX_SIGNATURES = 4;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Verify `X-Elapse-Signature` and parse the event (FR-SDK-020, FR-SDK-021;
 * detailed doc §4.4). Header: `t=<unix>,v1=<hex>[,v1=<hex>…]`. The signed
 * string is `${t}.${rawBody}`. Every `v1` is collected and every
 * (secret, v1) pair is compared in constant time with no early exit, so a
 * merchant mid secret-roll verifies against either secret and timing reveals
 * nothing about which matched. Always pass the raw request body: never a
 * re-serialised object (BR-SDK-003).
 */
export function constructEvent(
  rawBody: string | Uint8Array,
  header: string | undefined,
  secret: string | readonly string[] | undefined,
  options: ConstructEventOptions = {},
): ElapseEvent {
  if (header === undefined || header === null) throw new ElapseSignatureVerificationError("Missing X-Elapse-Signature header.");
  const secrets = typeof secret === "string" ? [secret] : secret === undefined ? [] : [...secret];
  if (secrets.length === 0 || secrets.some((s) => typeof s !== "string" || s.length === 0)) {
    throw new ElapseSignatureVerificationError("At least one non-empty webhook secret is required.");
  }

  const { t, signatures } = parseHeader(header);

  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_S;
  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tolerance) {
    throw new ElapseSignatureVerificationError(`Timestamp outside the tolerance zone (${tolerance} s).`);
  }

  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const payload = `${t}.${body}`;
  let matched = false;
  for (const s of secrets) {
    const expected = Buffer.from(createHmac("sha256", s).update(payload).digest("hex"), "hex");
    for (const sig of signatures) {
      const given = Buffer.from(sig, "hex");
      // Both are 32 bytes (HEX64 enforced above), so timingSafeEqual never throws.
      if (timingSafeEqual(given, expected)) matched = true; // no break: compare every pair
    }
  }
  if (!matched) throw new ElapseSignatureVerificationError("No signatures found matching the expected signature for payload.");

  try {
    return JSON.parse(body) as ElapseEvent;
  } catch {
    throw new ElapseSignatureVerificationError("Payload is not valid JSON.");
  }
}

function parseHeader(header: string): { t: number; signatures: string[] } {
  let t: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new ElapseSignatureVerificationError("Malformed X-Elapse-Signature header.");
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (t !== undefined || !/^\d+$/.test(value)) throw new ElapseSignatureVerificationError("Malformed X-Elapse-Signature header: bad timestamp.");
      t = Number(value);
    } else if (key === "v1") {
      if (!HEX64.test(value)) throw new ElapseSignatureVerificationError("Malformed X-Elapse-Signature header: bad signature.");
      signatures.push(value);
    }
    // Unknown schemes (a future v2) are ignored, like Stripe.
  }
  if (t === undefined || signatures.length === 0) throw new ElapseSignatureVerificationError("Malformed X-Elapse-Signature header: missing t or v1.");
  if (signatures.length > MAX_SIGNATURES) throw new ElapseSignatureVerificationError("Malformed X-Elapse-Signature header: too many signatures.");
  return { t, signatures };
}
