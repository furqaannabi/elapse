import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/http";
import type { Product } from "../src/resources";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("FR-SDK-042 release 0.1.4", () => {
  it("FR_SDK_042_the_package_is_0_1_4", () => {
    // The workspace build carries subscriptions.start and startMode; the published 0.1.3 has neither.
    expect(pkg.version).toBe("0.1.4");
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
