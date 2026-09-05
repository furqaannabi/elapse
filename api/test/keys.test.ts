import { describe, expect, test } from "bun:test";
import { generateKey, hashKey, parseKey } from "../src/lib/keys";
import { newId } from "../src/lib/ids";

describe("FR-API-002 keys", () => {
  test("secret keys carry the mode in the prefix and 24 random base62 chars", () => {
    const k = generateKey("sk", false);
    expect(k.plaintext).toMatch(/^sk_test_[0-9A-Za-z]{24}$/);
    expect(generateKey("sk", true).plaintext).toMatch(/^sk_live_[0-9A-Za-z]{24}$/);
    expect(generateKey("pk", false).plaintext).toMatch(/^pk_test_[0-9A-Za-z]{24}$/);
    expect(generateKey("pk", true).plaintext).toMatch(/^pk_live_[0-9A-Za-z]{24}$/);
  });

  test("hash is SHA-256 of the plaintext, last4 is the last four chars, and the two never leak the rest", () => {
    const k = generateKey("sk", false);
    expect(k.hash).toEqual(hashKey(k.plaintext));
    expect(k.hash.byteLength).toBe(32);
    expect(k.last4).toBe(k.plaintext.slice(-4));
    expect(Buffer.from(k.hash).toString("hex")).not.toContain(k.plaintext.slice(8, 16));
  });

  test("two keys never collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateKey("sk", false).plaintext);
    expect(seen.size).toBe(1000);
  });

  test("parseKey reads kind and mode from a well-formed key and rejects anything else", () => {
    expect(parseKey("sk_test_" + "a".repeat(24))).toEqual({ kind: "sk", livemode: false });
    expect(parseKey("pk_live_" + "b".repeat(24))).toEqual({ kind: "pk", livemode: true });
    expect(parseKey("sk_test_short")).toBeNull();
    expect(parseKey("whsec_" + "a".repeat(24))).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey("sk_test_" + "a".repeat(24) + "\n")).toBeNull();
  });
});

describe("ids", () => {
  test("object ids are prefix + 14 base62 chars (technical design §2)", () => {
    expect(newId("prod")).toMatch(/^prod_[0-9A-Za-z]{14}$/);
    expect(newId("mrc")).toMatch(/^mrc_[0-9A-Za-z]{14}$/);
    expect(newId("prod")).not.toBe(newId("prod"));
  });
});
