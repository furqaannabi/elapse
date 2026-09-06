import { describe, expect, it } from "vitest";
import { Entitlements } from "../src/entitlements";
import { event } from "./sign";

const sub = { id: "sub_4QeABC", object: "subscription", customer: "cus_7Ha", product: "prod_9f2", status: "active" };
const inv = { id: "in_1", object: "invoice", subscription: "sub_4QeABC", amount_settled: "0.33", status: "paid" };
const parse = (s: string) => JSON.parse(s);

describe("FR-EXM-023 merchant actions per type", () => {
  it("checkout.session.completed → provision access, no entitlement yet", () => {
    const e = new Entitlements();
    expect(e.apply(parse(event("checkout.session.completed", { id: "cs_1", object: "checkout.session", subscription: "sub_4QeABC", customer: "cus_7Ha" })))).toBe("provision access sub_4QeABC");
    expect(e.get("sub_4QeABC")).toEqual({ entitled: false, reason: "pending webhook" });
  });

  it("subscription.created → mark entitled", () => {
    const e = new Entitlements();
    expect(e.apply(parse(event("subscription.created", sub)))).toBe("mark entitled sub_4QeABC");
    expect(e.get("sub_4QeABC")).toEqual({ entitled: true, reason: "active" });
  });

  it("subscription.updated → sync entitlement (status); paused is not entitled", () => {
    const e = new Entitlements();
    e.apply(parse(event("subscription.created", sub)));
    expect(e.apply(parse(event("subscription.updated", { ...sub, status: "paused" })))).toBe("sync entitlement (paused) sub_4QeABC");
    expect(e.get("sub_4QeABC")).toEqual({ entitled: false, reason: "paused" });
    e.apply(parse(event("subscription.updated", { ...sub, status: "active" }, "evt_2")));
    expect(e.get("sub_4QeABC").entitled).toBe(true);
  });

  it("invoice.settled → book revenue, entitlement untouched", () => {
    const e = new Entitlements();
    e.apply(parse(event("subscription.created", sub)));
    expect(e.apply(parse(event("invoice.settled", inv)))).toBe("book revenue $0.33 sub_4QeABC");
    expect(e.get("sub_4QeABC").entitled).toBe(true);
  });

  it("invoice.payment_failed → revoke access (payment failed)", () => {
    const e = new Entitlements();
    e.apply(parse(event("subscription.created", sub)));
    expect(e.apply(parse(event("invoice.payment_failed", { ...inv, status: "failed", amount_settled: "0" })))).toBe("revoke access (payment failed) sub_4QeABC");
    expect(e.get("sub_4QeABC")).toEqual({ entitled: false, reason: "payment failed" });
  });

  it("unknown type → ignored", () => {
    expect(new Entitlements().apply(parse(event("subscription.renamed", sub)))).toBe("ignored");
  });
});
