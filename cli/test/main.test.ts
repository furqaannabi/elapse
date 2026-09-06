import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { main, type MainIO } from "../src/main";
import { startMockPlatform, type MockPlatform } from "./mock-platform";

let platform: MockPlatform;
let out: string[];
let err: string[];
let configDir: string;
const io = (over: Partial<MainIO> = {}): MainIO => ({
  env: { ELAPSE_BASE_URL: platform.url },
  stdout: (l) => out.push(l),
  stderr: (l) => err.push(l),
  configDir,
  prompt: async () => "sk_test_typed",
  isTTY: false,
  ...over,
});

beforeEach(async () => {
  platform = await startMockPlatform();
  out = [];
  err = [];
  configDir = mkdtempSync(join(tmpdir(), "elapse-cli-"));
});
afterEach(async () => platform.close());

describe("FR-CLI-024 help lists exactly the commands", () => {
  test("elapse --help", async () => {
    expect(await main(["--help"], io())).toBe(0);
    const text = out.join("\n");
    for (const c of ["login", "logout", "listen", "events list", "events resend", "products create", "checkout create"]) expect(text).toContain(c);
    expect(text).not.toMatch(/test-clocks|test_clocks/);
    expect(text).toContain("--api-key");
    expect(text).toContain("--base-url");
    expect(text).toContain("--json");
  });

  test("elapse listen --help; unknown command → 2 with usage", async () => {
    expect(await main(["listen", "--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("--forward");
    expect(out.join("\n")).toContain("--events");
    expect(await main(["frobnicate"], io())).toBe(2);
    expect(err.join("\n")).toContain("Unknown command");
    expect(await main(["--version"], io())).toBe(0);
    expect(out.join("\n")).toMatch(/^0\.\d+\.\d+$/m);
  });
});

describe("FR-CLI-001 / FR-CLI-032 auth and exit codes", () => {
  test("no key anywhere → 2 with the one-line hint", async () => {
    expect(await main(["events", "list"], io())).toBe(2);
    expect(err.join("\n")).toContain("Set ELAPSE_SECRET_KEY or run: elapse login");
  });

  test("a rejected key → 2 with the API message; a network failure → 1", async () => {
    expect(await main(["events", "list", "--api-key", "sk_test_bad"], io())).toBe(2);
    expect(err.join("\n")).toContain("Invalid API key provided.");
    expect(await main(["events", "list", "--api-key", "sk_test_x", "--base-url", "http://127.0.0.1:9/"], io())).toBe(1);
  });
});

describe("FR-CLI-002/003 login and logout", () => {
  test("login validates with products.list, saves the 0600 profile, prints merchant and mode; the key is never echoed", async () => {
    expect(await main(["login"], io())).toBe(0);
    const path = join(configDir, "config.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ secret_key: "sk_test_typed", livemode: false });
    expect(out.join("\n")).toMatch(/Logged in.*test mode/);
    expect(out.join("\n") + err.join("\n")).not.toContain("sk_test_typed");
    expect(platform.requests.some((r) => r.path.startsWith("/v1/products"))).toBe(true);
    // the profile now authenticates other commands
    out = [];
    expect(await main(["events", "list"], io({ prompt: async () => "" }))).toBe(0);
    expect(out.join("\n")).toContain("evt_2");
  });

  test("an invalid key stores nothing and exits 2", async () => {
    expect(await main(["login"], io({ prompt: async () => "sk_test_bad" }))).toBe(2);
    expect(existsSync(join(configDir, "config.json"))).toBe(false);
    expect(err.join("\n")).toContain("Invalid API key provided.");
  });

  test("logout removes the profile; a second logout says so", async () => {
    await main(["login"], io());
    expect(await main(["logout"], io())).toBe(0);
    expect(existsSync(join(configDir, "config.json"))).toBe(false);
    expect(await main(["logout"], io())).toBe(0);
    expect(out.join("\n")).toContain("No saved login");
  });
});

describe("FR-CLI-020/021 events", () => {
  const withKey = () => io({ env: { ELAPSE_BASE_URL: platform.url, ELAPSE_SECRET_KEY: "sk_test_x" } });

  test("events list prints a table; --type and --limit forwarded; --json emits the list on stdout", async () => {
    expect(await main(["events", "list", "--limit", "5", "--type", "subscription.canceled"], withKey())).toBe(0);
    expect(out[0]).toMatch(/^id\s+type\s+created\s+pending_webhooks$/);
    expect(out.join("\n")).toContain("evt_2");
    expect(platform.requests.at(-1)!.path).toBe("/v1/events?limit=5&type=subscription.canceled");
    out = [];
    expect(await main(["events", "list", "--json"], withKey())).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.data.map((e: any) => e.id)).toEqual(["evt_1", "evt_2"]);
  });

  test("events resend prints one line per delivery; unknown id → 1 with the API message", async () => {
    expect(await main(["events", "resend", "evt_2"], withKey())).toBe(0);
    expect(platform.requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/events/evt_2/resend" });
    expect(out.join("\n")).toMatch(/dlv_r1.*https:\/\/acme\.test\/hooks.*queued/);
    expect(out.join("\n")).toMatch(/dlv_r2.*CLI.*queued/);
    expect(await main(["events", "resend", "evt_nope"], withKey())).toBe(1);
    expect(err.join("\n")).toContain("No such event: 'evt_nope'");
    expect(await main(["events", "resend"], withKey())).toBe(2);
  });
});

describe("FR-CLI-022 products and checkout", () => {
  const withKey = () => io({ env: { ELAPSE_BASE_URL: platform.url, ELAPSE_SECRET_KEY: "sk_test_x" } });

  test("products create sends the §4.2 body and prints the id", async () => {
    expect(await main(["products", "create", "--name", "GPU · 4090", "--rate", "0.004"], withKey())).toBe(0);
    expect(platform.requests.at(-1)!.body).toEqual({ name: "GPU · 4090", rate_usd_per_second: "0.004" });
    expect(out.join("\n")).toContain("prod_mock1");
    expect(await main(["products", "create", "--name", "x", "--rate", "0.1.2"], withKey())).toBe(2);
  });

  test("checkout create sends product and urls and prints session.url", async () => {
    expect(await main(["checkout", "create", "--product", "prod_mock1", "--success-url", "https://acme.test/ok", "--cancel-url", "https://acme.test/no"], withKey())).toBe(0);
    expect(platform.requests.at(-1)!.body).toEqual({ product: "prod_mock1", success_url: "https://acme.test/ok", cancel_url: "https://acme.test/no" });
    expect(out.join("\n")).toContain("https://checkout.elapse.finance/c/cs_mock1");
    out = [];
    expect(await main(["checkout", "create", "--product", "prod_mock1", "--success-url", "https://acme.test/ok", "--cancel-url", "https://acme.test/no", "--json"], withKey())).toBe(0);
    expect(JSON.parse(out.join("\n")).id).toBe("cs_mock1");
  });
});
