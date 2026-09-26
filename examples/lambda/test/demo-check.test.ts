import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { demoCheck } from "../src/demo-check";
import { createServer } from "../src/server";
import { createSessionStore } from "../src/session";
import { mockRunner } from "../src/executor";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(secret: string) {
  const server = createServer({
    sessions: createSessionStore({ dailyRunLimit: 20 }),
    executor: mockRunner(),
    webhookSecret: secret,
    log: () => {},
    logJson: false,
    retrieveSubscription: async () => ({ k: "unreachable" as const }),
    ourProduct: "prod_northwind",
    createCheckoutSession: async () => ({ id: "cs_1" }),
    startSubscription: async () => {},
    cancelSubscription: async () => {},
    resumeSubscription: async () => {},
    product: { name: "Serverless runtime", rateUsdPerSecond: "0.002" },
    maxDurationSeconds: 3600,
    elapse: { publishableKey: "pk_test_abc", apiUrl: "https://api.elapse.finance", appUrl: "https://elapse.finance" },
    now: () => Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, r));
  close = () => new Promise((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("FR-EXM-150 demo:check", () => {
  it("passes when the server verifies the local signature and closes the session", async () => {
    const baseUrl = await serve("whsec_local");
    const r = await demoCheck({ baseUrl, webhookSecret: "whsec_local" });
    expect(r).toEqual({ ok: true, detail: expect.stringContaining("session closed") });
  });

  it("fails when the server loaded a different secret", async () => {
    const baseUrl = await serve("whsec_other");
    const r = await demoCheck({ baseUrl, webhookSecret: "whsec_local" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("400");
  });
});
