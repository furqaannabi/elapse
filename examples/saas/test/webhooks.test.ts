import { describe, expect, it } from "vitest";
import { Entitlements } from "../src/entitlements";
import { handleWebhook } from "../src/webhooks";
import { canceled, sign } from "./sign";

const SECRET = "whsec_test_secret";

function setup() {
  const lines: string[] = [];
  const entitlements = new Entitlements();
  const deps = { secret: SECRET, entitlements, log: (l: string) => lines.push(l), logJson: false };
  return { lines, entitlements, deps };
}

describe("FR-EXM-020/023 verified event", () => {
  it("responds 200 and logs revoke access with seconds and dollars for subscription.canceled", () => {
    const { lines, entitlements, deps } = setup();
    const body = canceled();
    const res = handleWebhook(body, sign(body, SECRET), deps);
    expect(res.status).toBe(200);
    res.work?.();
    expect(lines).toEqual(["evt_1S2bXYZ  subscription.canceled   → revoke access · 83s · $0.33"]);
    expect(entitlements.get("sub_4QeABC")).toEqual({ entitled: false, reason: "canceled" });
  });
});

describe("FR-EXM-021 rejection", () => {
  it.each([
    ["missing header", (b: string) => undefined],
    ["tampered body", (b: string) => sign(b.replace("83", "1"), SECRET)],
    ["wrong secret", (b: string) => sign(b, "whsec_other")],
    ["expired timestamp", (b: string) => sign(b, SECRET, Math.floor(Date.now() / 1000) - 600)],
  ])("%s → 400, one rejected line, map unchanged", (_name, header) => {
    const { lines, entitlements, deps } = setup();
    const body = canceled();
    const res = handleWebhook(body, header(body), deps);
    expect(res.status).toBe(400);
    expect(res.body).toBe('{"error":"invalid signature"}');
    expect(res.work).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^✗ rejected: /);
    expect(entitlements.get("sub_4QeABC")).toEqual({ entitled: false, reason: "unknown subscription" });
  });
});

describe("FR-EXM-022 dedupe", () => {
  it("a redelivered Event logs duplicate and changes nothing", () => {
    const { lines, deps } = setup();
    const body = canceled();
    for (let i = 0; i < 2; i++) handleWebhook(body, sign(body, SECRET), deps).work?.();
    expect(lines).toEqual(["evt_1S2bXYZ  subscription.canceled   → revoke access · 83s · $0.33", "↺ duplicate evt_1S2bXYZ"]);
  });
});
