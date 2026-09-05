import { randomBase62 } from "./ids";

export type KeyKind = "pk" | "sk";

export interface GeneratedKey {
  /** Returned to the merchant exactly once (FR-API-002, BR-API-003). */
  plaintext: string;
  /** SHA-256 of the plaintext; the only thing stored for `sk_` keys. */
  hash: Uint8Array;
  /** Last four characters, for display as `sk_test_…abcd`. */
  last4: string;
}

const KEY_RE = /^(pk|sk)_(test|live)_[0-9A-Za-z]{24}$/;

/** SHA-256 of a key's plaintext. Random 24-char base62 keys have ~143 bits of entropy, so a plain hash is sufficient (no salt, no KDF) and lets the auth middleware look a key up by hash in one indexed query. */
export function hashKey(plaintext: string): Uint8Array {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(plaintext);
  return new Uint8Array(hasher.digest());
}

/** Mint a new `pk_`/`sk_` key for one mode. Format: `sk_test_` + 24 base62 chars. */
export function generateKey(kind: KeyKind, livemode: boolean): GeneratedKey {
  const plaintext = `${kind}_${livemode ? "live" : "test"}_${randomBase62(24)}`;
  return { plaintext, hash: hashKey(plaintext), last4: plaintext.slice(-4) };
}

/** Kind and mode from a presented key, or null if it is not shaped like one of ours. Shape check only; existence is the middleware's job. */
export function parseKey(presented: string): { kind: KeyKind; livemode: boolean } | null {
  const m = KEY_RE.exec(presented);
  if (!m) return null;
  return { kind: m[1] as KeyKind, livemode: m[2] === "live" };
}
