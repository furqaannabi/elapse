/**
 * FR-EXM-158: which of the merchant's own meters Northwind re-adopts when it comes up. Pure — the
 * `subscriptions.list` call lives in boot, so the decision tests without the SDK.
 */
import { describe, expect, it } from "vitest";
import { reconcileBoot } from "../src/claim";

const OURS = "prod_northwind";

describe("FR-EXM-158 Northwind reconciles its own meters on boot", () => {
  it("re-adopts a paused meter on its own product, in the state the platform reports", () => {
    expect(
      reconcileBoot([{ id: "sub_1", product: OURS, status: "paused", started_at: 1_790_025_263 }], OURS),
    ).toEqual([{ sub: "sub_1", state: "paused", startedAt: 1_790_025_263_000 }]);
  });

  it("leaves another merchant's product and every subscription that is not running alone", () => {
    // `incomplete` is deliberate: a subscription authorised but never started is the unstarted
    // sweep's business (FR-EXM-126, worker FR-WRK-075), not something to adopt as a live meter.
    const rows = [
      { id: "sub_theirs", product: "prod_elsewhere", status: "active", started_at: 1 },
      { id: "sub_incomplete", product: OURS, status: "incomplete" },
      { id: "sub_gone", product: OURS, status: "canceled", started_at: 1 },
      { id: "sub_mine", product: OURS, status: "active", started_at: 2 },
    ];
    expect(reconcileBoot(rows, OURS)).toEqual([{ sub: "sub_mine", state: "active", startedAt: 2000 }]);
  });

  it("skips a running meter the platform reports with no start time rather than inventing one", () => {
    // `startedAt` is what the console's elapsed reads from; a wrong one bills the subscriber for
    // seconds they never had.
    expect(reconcileBoot([{ id: "sub_1", product: OURS, status: "active", started_at: null }], OURS)).toEqual([]);
  });
});
