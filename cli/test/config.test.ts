import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { deleteProfile, resolveBaseUrl, resolveSecretKey, saveProfile } from "../src/config";

const dir = () => mkdtempSync(join(tmpdir(), "elapse-cli-"));

describe("FR-CLI-001 secret key precedence", () => {
  test("env beats --api-key beats profile; nothing → null", () => {
    const home = dir();
    expect(resolveSecretKey({ env: {}, flag: undefined, configDir: home })).toBeNull();
    saveProfile(home, { secret_key: "sk_test_profile", merchant_name: "Acme", livemode: false });
    expect(resolveSecretKey({ env: {}, flag: undefined, configDir: home })).toEqual({ key: "sk_test_profile", source: "profile" });
    expect(resolveSecretKey({ env: {}, flag: "sk_test_flag", configDir: home })).toEqual({ key: "sk_test_flag", source: "flag" });
    expect(resolveSecretKey({ env: { ELAPSE_SECRET_KEY: "sk_test_env" }, flag: "sk_test_flag", configDir: home })).toEqual({ key: "sk_test_env", source: "env" });
  });

  test("a malformed profile file is ignored, not fatal", () => {
    const home = dir();
    saveProfile(home, { secret_key: "sk_test_profile", merchant_name: "Acme", livemode: false });
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(home, "config.json"), "{not json");
    expect(resolveSecretKey({ env: {}, flag: undefined, configDir: home })).toBeNull();
  });
});

describe("FR-CLI-002/003 profile file", () => {
  test("saved with mode 0600 inside the config dir; logout removes it", () => {
    const home = dir();
    const path = saveProfile(home, { secret_key: "sk_live_abc", merchant_name: "Acme", livemode: true });
    expect(path).toBe(join(home, "config.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ secret_key: "sk_live_abc", merchant_name: "Acme", livemode: true });
    expect(deleteProfile(home)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(deleteProfile(home)).toBe(false);
  });

  test("base url: --base-url beats ELAPSE_BASE_URL beats the default; trailing slash trimmed", () => {
    expect(resolveBaseUrl({ env: {}, flag: undefined })).toBe("https://api.elapse.dev");
    expect(resolveBaseUrl({ env: { ELAPSE_BASE_URL: "http://localhost:4000/" }, flag: undefined })).toBe("http://localhost:4000");
    expect(resolveBaseUrl({ env: { ELAPSE_BASE_URL: "http://localhost:4000" }, flag: "https://staging.elapse.dev" })).toBe("https://staging.elapse.dev");
  });
});
