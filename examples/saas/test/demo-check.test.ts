import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { demoCheck } from "../src/demo-check";
import { Entitlements } from "../src/entitlements";
import { createServer } from "../src/server";

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function serve(secret: string) {
  const server = createServer({ entitlements: new Entitlements(), webhookSecret: secret, log: () => {}, logJson: false, createSession: async () => ({ id: "cs_1", url: "https://elapse.finance/c/cs_1" }), product: { name: "GPU · 4090", rateUsdPerSecond: "0.004" } });
  await new Promise<void>((r) => server.listen(0, r));
  close = () => new Promise((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("FR-EXM-030 demo:check", () => {
  it("passes when the server verifies the local signature and revokes access", async () => {
    const baseUrl = await serve("whsec_local");
    const r = await demoCheck({ baseUrl, webhookSecret: "whsec_local" });
    expect(r).toEqual({ ok: true, detail: expect.stringContaining("revoke access") });
  });

  it("fails when the server has a different secret", async () => {
    const baseUrl = await serve("whsec_other");
    const r = await demoCheck({ baseUrl, webhookSecret: "whsec_local" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("400");
  });
});
