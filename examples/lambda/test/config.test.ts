import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const full = {
  ELAPSE_SECRET_KEY: "sk_test_abc",
  ELAPSE_PUBLISHABLE_KEY: "pk_test_abc",
  ELAPSE_WEBHOOK_SECRET: "whsec_abc",
  ELAPSE_API_URL: "http://localhost:4000",
  LAMBDA_FN: "elapse-lambda-runner",
};

describe("FR-EXM-101 config", () => {
  it("names LAMBDA_FN when it is missing", () => {
    const { LAMBDA_FN: _, ...env } = full;
    expect(() => loadConfig(env)).toThrow(/^LAMBDA_FN is missing\./);
  });

  it("names ELAPSE_PUBLISHABLE_KEY when missing: the console cannot authorise without it", () => {
    const { ELAPSE_PUBLISHABLE_KEY: _, ...env } = full;
    expect(() => loadConfig(env)).toThrow(/^ELAPSE_PUBLISHABLE_KEY is missing\./);
  });

  it("names ELAPSE_SECRET_KEY and ELAPSE_API_URL when missing", () => {
    const { ELAPSE_SECRET_KEY: _a, ...noKey } = full;
    expect(() => loadConfig(noKey)).toThrow(/^ELAPSE_SECRET_KEY is missing\./);
    const { ELAPSE_API_URL: _b, ...noUrl } = full;
    expect(() => loadConfig(noUrl)).toThrow(/^ELAPSE_API_URL is missing\./);
  });

  it("defaults region, port, cap and auto-end windows, and strips trailing slashes", () => {
    const c = loadConfig({ ...full, ELAPSE_API_URL: "http://localhost:4000/", BASE_URL: "http://localhost:3000/" });
    expect(c).toEqual({
      secretKey: "sk_test_abc",
      publishableKey: "pk_test_abc",
      webhookSecret: "whsec_abc",
      appUrl: "https://elapse.finance",
      apiUrl: "http://localhost:4000",
      lambdaFn: "elapse-lambda-runner",
      awsRegion: "us-east-1",
      port: 3000,
      baseUrl: "http://localhost:3000",
      dailyRunLimit: 20,
      maxDurationSeconds: 3600,
      idleTimeoutSeconds: 60,
      heartbeatStaleSeconds: 15,
    });
  });

  it("reads overridden numeric knobs and rejects a non-positive one", () => {
    const c = loadConfig({ ...full, DAILY_RUN_LIMIT: "5", IDLE_TIMEOUT_SECONDS: "30" });
    expect(c.dailyRunLimit).toBe(5);
    expect(c.idleTimeoutSeconds).toBe(30);
    expect(() => loadConfig({ ...full, DAILY_RUN_LIMIT: "0" })).toThrow(/^DAILY_RUN_LIMIT must be a positive number/);
  });

  it("names a value still carrying the template's ellipsis", () => {
    expect(() => loadConfig({ ...full, ELAPSE_SECRET_KEY: "sk_test_…" })).toThrow(new ConfigError("ELAPSE_SECRET_KEY still has the placeholder from .env.example. Dashboard → Developers → API keys → Create."));
  });
});
