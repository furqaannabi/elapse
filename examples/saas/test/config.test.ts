import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

const full = {
  ELAPSE_SECRET_KEY: "sk_test_abc",
  ELAPSE_WEBHOOK_SECRET: "whsec_abc",
  ELAPSE_API_URL: "http://localhost:4000",
};

describe("FR-EXM-002 config", () => {
  it("names the missing variable", () => {
    const { ELAPSE_SECRET_KEY: _, ...env } = full;
    expect(() => loadConfig(env)).toThrow(new ConfigError("ELAPSE_SECRET_KEY is missing. Dashboard → Developers → API keys → Create."));
  });
});

describe("FR-EXM-002 config, more", () => {
  it("names ELAPSE_API_URL when it is missing", () => {
    const { ELAPSE_API_URL: _, ...env } = full;
    expect(() => loadConfig(env)).toThrow(/^ELAPSE_API_URL is missing\./);
  });

  it("defaults PORT and BASE_URL and strips trailing slashes", () => {
    const c = loadConfig({ ...full, ELAPSE_API_URL: "http://localhost:4000/" });
    expect(c).toEqual({ secretKey: "sk_test_abc", webhookSecret: "whsec_abc", apiUrl: "http://localhost:4000", port: 3000, baseUrl: "http://localhost:3000" });
  });
});
