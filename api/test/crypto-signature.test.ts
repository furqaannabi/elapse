import { describe, expect, test } from "bun:test";
import { constructEvent } from "@elapse/sdk";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";
import { generateWebhookSecret, signPayload } from "../src/lib/signature";

describe("secrets at rest (FR-API-060, Undecided 7)", () => {
  test("AES-GCM round trip; ciphertext differs per call; no plaintext in the blob", () => {
    const s = generateWebhookSecret();
    const a = encryptSecret(s);
    const b = encryptSecret(s);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(decryptSecret(a)).toBe(s);
    expect(decryptSecret(b)).toBe(s);
    expect(Buffer.from(a).toString("latin1")).not.toContain(s.slice(6, 20));
  });

  test("a tampered blob fails to decrypt", () => {
    const blob = encryptSecret(generateWebhookSecret());
    blob[blob.length - 1]! ^= 0x01;
    expect(() => decryptSecret(blob)).toThrow();
  });

  test("whsec_ format", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[0-9A-Za-z]{32}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("FR-WRK-020/021 signing round-trips with the real SDK", () => {
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "subscription.canceled", created: 1, data: { object: { id: "sub_1" } } });

  test("header shape: t=<unix>,v1=<64 hex>", () => {
    const h = signPayload(body, ["whsec_a"], 1_700_000_000);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  test("SDK constructEvent accepts what we sign", () => {
    const secret = generateWebhookSecret();
    const t = Math.floor(Date.now() / 1000);
    const evt = constructEvent(body, signPayload(body, [secret], t), secret);
    expect(evt.id).toBe("evt_1");
  });

  test("tampered body, wrong secret, or a t outside 300 s are rejected by the SDK", () => {
    const secret = generateWebhookSecret();
    const t = Math.floor(Date.now() / 1000);
    const h = signPayload(body, [secret], t);
    expect(() => constructEvent(body.replace("sub_1", "sub_2"), h, secret)).toThrow();
    expect(() => constructEvent(body, h, generateWebhookSecret())).toThrow();
    expect(() => constructEvent(body, signPayload(body, [secret], t - 301), secret)).toThrow();
  });

  test("during a roll both secrets sign; the old secret's v1 is last so the current SDK still verifies it (FR-WRK-041)", () => {
    const fresh = generateWebhookSecret();
    const old = generateWebhookSecret();
    const t = Math.floor(Date.now() / 1000);
    const h = signPayload(body, [fresh, old], t);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
    expect(constructEvent(body, h, old).id).toBe("evt_1");
  });
});
