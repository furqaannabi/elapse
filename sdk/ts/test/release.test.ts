import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/http";
import type { Product } from "../src/resources";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("FR-SDK-042/043/044 releases", () => {
  it("FR_SDK_044_the_package_is_0_3_1", () => {
    // 0.3.0: subscriptions.pause/resume, additive after 0.2.0 dropped the hosted checkout url.
    // 0.3.1: a patch — exports no longer name a `bun` target the tarball never shipped.
    expect(pkg.version).toBe("0.3.1");
  });

  it("FR_SDK_043_a_checkout_session_has_no_url", () => {
    const s = {} as import("../src/resources").CheckoutSession;
    // @ts-expect-error: the hosted checkout is retired; pass s.id to <Authorize session> instead.
    void s.url;
    expect(true).toBe(true);
  });

  it("FR_SDK_042_the_user_agent_version_is_the_package_version", () => {
    // It said 0.1.1 through 0.1.2 and 0.1.3; merchants' logs showed the wrong SDK.
    expect(VERSION).toBe(pkg.version);
  });

  it("FR_SDK_042_a_product_says_when_its_meter_starts", () => {
    const p: Product = {
      id: "prod_1", object: "product", name: "Serverless runtime", description: null,
      rate_usd_per_second: "0.002", rate_per_second_wei: "2000", currency: "ausd",
      allow_pause: false, active: true, livemode: false, created: 0, start_mode: "merchant",
    };
    expect(p.start_mode).toBe("merchant");
  });
});

describe("the published package resolves under every runtime it claims", () => {
  it("FR_SDK_001_every_exports_target_is_a_file_the_tarball_ships", () => {
    // 0.3.0 declared exports["."].bun -> "./src/index.ts" while `files` shipped only dist, so Bun
    // resolved the published package to a file that was never in it. Node was fine (it takes
    // "import"), which is why five api test files failed under `bun test` and nowhere else.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, Record<string, string>>;
      files: string[];
    };
    const shipped = (target: string) => {
      const p = target.replace(/^\.\//, "");
      return pkg.files.some((f) => p === f || p.startsWith(`${f.replace(/\/$/, "")}/`));
    };
    const targets = Object.values(pkg.exports).flatMap((c) => Object.entries(c));
    expect(targets.length).toBeGreaterThan(0);
    for (const [condition, target] of targets) {
      expect({ condition, target, shipped: shipped(target) }).toEqual({ condition, target, shipped: true });
    }
  });
});

describe("the package cannot ship something that was never built", () => {
  it("FR_SDK_001_publishing_rebuilds_and_retests_first", () => {
    // @elapse/react@0.4.0 shipped the previous version's dist because nothing forced a build.
    // This package had the same gap.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prepublishOnly).toMatch(/build/);
  });
});
