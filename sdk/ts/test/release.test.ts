import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/http";
import type { Product } from "../src/resources";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("FR-SDK-042/043/044 releases", () => {
  it("FR_SDK_044_the_package_is_0_3_0", () => {
    // 0.3.0: subscriptions.pause/resume, additive after 0.2.0 dropped the hosted checkout url.
    expect(pkg.version).toBe("0.3.0");
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
