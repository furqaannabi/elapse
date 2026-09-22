/**
 * FR-EXM-157: what Northwind may do with a `sub_` the browser hands it. Pure, so every branch of
 * the decision is testable without the SDK, a network or a clock.
 */
import { describe, expect, it } from "vitest";
import { claimVerdict } from "../src/claim";

const OURS = "prod_northwind";
const found = (over: Partial<{ checkoutSession: string; product: string; status: string }> = {}) =>
  ({ k: "found", checkoutSession: "cs_1", product: OURS, status: "incomplete", ...over }) as const;

describe("FR-EXM-157 the claim is verified before it is believed", () => {
  it("adopts a subscription whose checkout session Northwind issued and has not consumed", () => {
    expect(
      claimVerdict({ retrieved: found(), issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "adopt" });
  });

  it("refuses a subscription the platform says is not this merchant's, and does not call it unverifiable", () => {
    // A 404 is the platform answering. Calling that "unverifiable" would leave the console waiting
    // for a reconcile that can never adopt it.
    expect(
      claimVerdict({ retrieved: { k: "not_found" }, issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "refuse", reason: "not_ours" });
  });

  it("calls a canceled subscription spent, so a new Checkout session is the right answer", () => {
    expect(
      claimVerdict({ retrieved: found({ status: "canceled" }), issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "spent" });
  });

  it.each(["active", "paused"] as const)("adopts a %s meter in the state the platform reports, never as authorised", (status) => {
    // Reachable when the server restarted between the authorise and this claim. Writing
    // `authorised` here would make the next Run call `start` on a meter that is already running;
    // answering `spent` would open a second session against a live one. Neither is allowed
    // (FR-EXM-114/133).
    expect(
      claimVerdict({ retrieved: found({ status }), issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "running", status });
  });

  it("refuses a subscription whose checkout session Northwind never issued", () => {
    // The whole point of the binding: a valid `sub_` belonging to this merchant is not enough, or
    // anyone holding another subscriber's id could run code on a meter that person is paying for.
    expect(
      claimVerdict({ retrieved: found({ checkoutSession: "cs_someone_else" }), issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "refuse", reason: "not_ours" });
  });

  it("refuses a checkout session that has already been consumed", () => {
    // One `cs_` buys one session, so a second tab opens its own rather than adopting the first's.
    expect(claimVerdict({ retrieved: found(), issued: new Set(), ourProduct: OURS })).toEqual({
      k: "refuse",
      reason: "not_ours",
    });
  });

  it("refuses another merchant's product even on an issued checkout session", () => {
    expect(
      claimVerdict({ retrieved: found({ product: "prod_elsewhere" }), issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "refuse", reason: "not_ours" });
  });

  it("refuses as unverifiable when the platform did not answer, so nothing is charged and nothing is opened", () => {
    expect(
      claimVerdict({ retrieved: { k: "unreachable" }, issued: new Set(["cs_1"]), ourProduct: OURS }),
    ).toEqual({ k: "refuse", reason: "unverifiable" });
  });
});
