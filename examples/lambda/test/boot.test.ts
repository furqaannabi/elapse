import { afterEach, describe, expect, it } from "vitest";
import { boot } from "../src/boot";
import type { Config } from "../src/config";
import { mockApi } from "./mock-api";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const config = (apiUrl: string): Config => ({
  secretKey: "sk_test_abc",
  publishableKey: "pk_test_abc",
  webhookSecret: "whsec_abc",
  appUrl: "https://elapse.finance",
  apiUrl,
  lambdaFn: "elapse-lambda-runner",
  awsRegion: "us-east-1",
  port: 0,
  baseUrl: "http://localhost:3000",
  dailyRunLimit: 20,
  maxDurationSeconds: 3600,
  idleTimeoutSeconds: 60,
  heartbeatStaleSeconds: 15, pausedEndSeconds: 600,
});

async function run(existing?: Array<{ id: string; name: string; rate_usd_per_second: string; start_mode?: string }>) {
  const api = await mockApi(existing ? { existingProducts: existing } : {});
  closers.push(api.close);
  const out: string[] = [];
  const app = await boot(config(api.url), { out: (l) => out.push(l), log: () => {}, runnerMode: "mock" });
  closers.push(app.close);
  return { api, out, app };
}

describe("FR-EXM-102 npm start", () => {
  it("creates the Product and names the runner, without opening a checkout session", async () => {
    const { api, out } = await run();

    expect(api.requests.map((r) => [r.method, r.path])).toEqual([
      ["GET", "/v1/products?limit=100"],
      ["POST", "/v1/products"],
    ]);
    expect(api.requests.every((r) => r.auth === "Bearer sk_test_abc")).toBe(true);
    // FR-EXM-102 (amended): merchant start mode — the meter waits for the first Run (FR-EXM-125).
    // FR-EXM-156: without `allow_pause` the subscriber's <Meter> renders no Pause at all (FR-RCT-021).
    expect(api.requests[1]?.body).toEqual({ name: "Serverless runtime", rate_usd_per_second: "0.002", start_mode: "merchant", allow_pause: true });

    // FR-EXM-114: sessions are created on demand at first Run, never at boot.
    expect(api.requests.some((r) => r.path === "/v1/checkout/sessions")).toBe(false);

    expect(out).toEqual([
      "Product:  prod_new1  Serverless runtime  $0.002/s",
      "Webhooks: POST http://localhost:3000/webhooks",
      "Runner:   elapse-lambda-runner @ us-east-1",
      expect.stringMatching(/^Listening on :\d+$/),
    ]);
  });

  it("reuses an existing merchant-mode Product by name instead of creating another", async () => {
    const { api, out } = await run([{ id: "prod_old", name: "Serverless runtime", rate_usd_per_second: "0.002", start_mode: "merchant" }]);
    expect(api.requests.map((r) => r.method)).toEqual(["GET"]);
    expect(out[0]).toBe("Product:  prod_old  Serverless runtime  $0.002/s");
  });

  it("does not reuse a checkout-mode Product of the same name: its meter would start too early", async () => {
    const { api } = await run([{ id: "prod_old", name: "Serverless runtime", rate_usd_per_second: "0.002", start_mode: "checkout" }]);
    expect(api.requests.map((r) => r.method)).toEqual(["GET", "POST"]);
  });
});
