const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Unbiased random base62 string of `length` chars (rejection sampling over
 * `crypto.getRandomValues`, so no modulo bias).
 */
export function randomBase62(length: number): string {
  let out = "";
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62]!; // 248 = 4 × 62
    }
  }
  return out;
}

/** Stripe-style object id: `<prefix>_` + 14 base62 chars (technical design §2), e.g. `prod_…`, `cus_…`, `sub_…`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBase62(14)}`;
}
