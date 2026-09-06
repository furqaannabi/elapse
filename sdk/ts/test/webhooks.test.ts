import { createHmac } from "node:crypto";
import { describe, expect, it, expectTypeOf } from "vitest";
import { Elapse, ElapseError, ElapseSignatureVerificationError, constructEvent, type ElapseEvent } from "../src/index";

const secret = "whsec_" + "a".repeat(32);
const other = "whsec_" + "b".repeat(32);
const body = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "subscription.canceled",
  created: 1_700_000_000,
  livemode: false,
  data: { object: { id: "sub_1", status: "canceled", seconds_elapsed: 83, amount_settled: "0.332", currency: "ausd", product: "prod_1", customer: "cus_1" } },
  pending_webhooks: 1,
});
const now = 1_700_000_100;
const sign = (s: string, t: number, b = body) => createHmac("sha256", s).update(`${t}.${b}`).digest("hex");
const header = (t: number, ...sigs: string[]) => `t=${t},${sigs.map((v) => `v1=${v}`).join(",")}`;
const clock = { now: () => now };

describe("FR-SDK-020 constructEvent", () => {
  it("verifies a good header and returns the parsed event", () => {
    const evt = constructEvent(body, header(now, sign(secret, now)), secret, clock);
    expect(evt.id).toBe("evt_1");
    expect(evt.type).toBe("subscription.canceled");
  });

  it("accepts a Buffer body", () => {
    const evt = constructEvent(Buffer.from(body, "utf8"), header(now, sign(secret, now)), secret, clock);
    expect(evt.id).toBe("evt_1");
  });

  it("collects every v1: with two values it accepts if either matches (secret roll)", () => {
    const h = header(now, sign(other, now), sign(secret, now));
    expect(constructEvent(body, h, secret, clock).id).toBe("evt_1");
    const h2 = header(now, sign(secret, now), sign(other, now));
    expect(constructEvent(body, h2, secret, clock).id).toBe("evt_1");
  });

  it("accepts an array of secrets and matches against any", () => {
    const h = header(now, sign(other, now));
    expect(constructEvent(body, h, [secret, other], clock).id).toBe("evt_1");
  });

  it("is the same function on the client namespace and standalone (FR-SDK-024)", () => {
    const client = new Elapse({ secretKey: "sk_test_" + "x".repeat(24) });
    expect(client.webhooks.constructEvent(body, header(now, sign(secret, now)), secret, clock).id).toBe("evt_1");
  });
});

describe("FR-SDK-021 rejections", () => {
  const cases: [string, () => unknown, RegExp][] = [
    ["missing header", () => constructEvent(body, undefined, secret, clock), /missing/i],
    ["empty header", () => constructEvent(body, "", secret, clock), /missing|malformed/i],
    ["no t", () => constructEvent(body, `v1=${sign(secret, now)}`, secret, clock), /malformed/i],
    ["no v1", () => constructEvent(body, `t=${now}`, secret, clock), /malformed/i],
    ["non-numeric t", () => constructEvent(body, `t=abc,v1=${sign(secret, now)}`, secret, clock), /malformed/i],
    ["non-hex v1", () => constructEvent(body, `t=${now},v1=zz${sign(secret, now).slice(2)}`, secret, clock), /malformed/i],
    ["more than 4 v1", () => constructEvent(body, header(now, ...Array(5).fill(sign(secret, now))), secret, clock), /malformed/i],
    ["expired +301", () => constructEvent(body, header(now - 301, sign(secret, now - 301)), secret, clock), /timestamp|tolerance/i],
    ["expired -301 (future)", () => constructEvent(body, header(now + 301, sign(secret, now + 301)), secret, clock), /timestamp|tolerance/i],
    ["tampered body", () => constructEvent(body.replace("sub_1", "sub_2"), header(now, sign(secret, now)), secret, clock), /no signatures? found|match/i],
    ["wrong secret", () => constructEvent(body, header(now, sign(secret, now)), other, clock), /no signatures? found|match/i],
    ["wrong t", () => constructEvent(body, header(now, sign(secret, now - 5)), secret, clock), /no signatures? found|match/i],
    ["two v1 neither matching", () => constructEvent(body, header(now, sign(other, now), sign(other, now - 1)), secret, clock), /no signatures? found|match/i],
    ["empty secret array", () => constructEvent(body, header(now, sign(secret, now)), [], clock), /secret/i],
  ];
  it.each(cases)("%s → ElapseSignatureVerificationError", (_name, fn, message) => {
    let err: unknown;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ElapseSignatureVerificationError);
    expect(err).toBeInstanceOf(ElapseError);
    expect((err as Error).message).toMatch(message);
    // never echoes the body or the secret
    expect((err as Error).message).not.toContain("sub_1");
    expect((err as Error).message).not.toContain(secret);
  });

  it("boundary: exactly 300 s old is accepted, 301 is not", () => {
    expect(constructEvent(body, header(now - 300, sign(secret, now - 300)), secret, clock).id).toBe("evt_1");
    expect(() => constructEvent(body, header(now - 301, sign(secret, now - 301)), secret, clock)).toThrow(ElapseSignatureVerificationError);
  });
});

describe("FR-SDK-022 options", () => {
  it("tolerance: Infinity accepts an old signature; a custom tolerance is honoured", () => {
    const h = header(now - 100_000, sign(secret, now - 100_000));
    expect(constructEvent(body, h, secret, { now: () => now, tolerance: Infinity }).id).toBe("evt_1");
    expect(() => constructEvent(body, header(now - 10, sign(secret, now - 10)), secret, { now: () => now, tolerance: 5 })).toThrow();
  });

  it("defaults to the wall clock when no clock is given", () => {
    const t = Math.floor(Date.now() / 1000);
    expect(constructEvent(body, header(t, sign(secret, t)), secret).id).toBe("evt_1");
  });
});

describe("FR-SDK-023 typing", () => {
  it("narrows on type; unknown types still verify and come back with type: string (Undecided 5)", () => {
    const evt = constructEvent(body, header(now, sign(secret, now)), secret, clock);
    if (evt.type === "subscription.canceled") {
      expectTypeOf(evt.data.object.seconds_elapsed).toEqualTypeOf<number>();
      expect(evt.data.object.amount_settled).toBe("0.332");
      expectTypeOf(evt.data.object.amount_settled).toEqualTypeOf<string>();
    } else {
      throw new Error("expected subscription.canceled");
    }
    const future = body.replace("subscription.canceled", "subscription.frobnicated");
    const f = constructEvent(future, header(now, sign(secret, now, future)), secret, clock);
    expect(f.type).toBe("subscription.frobnicated");
    expectTypeOf<ElapseEvent["type"]>().toEqualTypeOf<string>();
  });
});

/** FR-DOC-031: the vector printed on the docs Signatures page must verify here, or the page lies. */
describe("published test vector (sdk/ts/test/docs-vector.json, synced into the docs)", () => {
  it("verifies with constructEvent and by hand", async () => {
    const { readFileSync } = await import("node:fs");
    const { createHmac } = await import("node:crypto");
    const v = JSON.parse(readFileSync(new URL("./docs-vector.json", import.meta.url), "utf8")) as { secret: string; t: number; body: string; v1: string };
    expect(createHmac("sha256", v.secret).update(`${v.t}.${v.body}`).digest("hex")).toBe(v.v1);
    const event = constructEvent(v.body, `t=${v.t},v1=${v.v1}`, v.secret, { tolerance: Infinity });
    expect(event.type).toBe("subscription.canceled");
  });
});
