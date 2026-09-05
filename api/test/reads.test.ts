import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { insertProduct } from "../src/db/products";
import { insertCustomer } from "../src/db/customers";
import { insertSubscription } from "../src/db/subscriptions";
import { insertInvoice } from "../src/db/invoices";

let m: Fixture;
const T0 = 1_757_000_000;
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

/** Two customers, three subscriptions (two for customer A across two products), two invoices on the first. */
async function seed(livemode = false) {
  const p1 = await insertProduct({ merchantId: m.merchantId, livemode, name: "GPU", description: null, rateUsdPerSecond: "0.004", ratePerSecondWei: 4000n, allowPause: true });
  const p2 = await insertProduct({ merchantId: m.merchantId, livemode, name: "Stream", description: null, rateUsdPerSecond: "0.001", ratePerSecondWei: 1000n, allowPause: false });
  const a = await insertCustomer({ merchantId: m.merchantId, livemode, walletAddress: addr(1), email: "a@example.com" });
  const b = await insertCustomer({ merchantId: m.merchantId, livemode, walletAddress: addr(2) });
  const mk = (productId: string, customerId: string, address: string) =>
    insertSubscription({ merchantId: m.merchantId, livemode, productId, customerId, checkoutSessionId: null, chainId: livemode ? 143 : 10143, ratePerSecondWei: 4000n, maxDurationSeconds: 3600, maxEscrowWei: 14_400_000n, streamAddress: address });
  const s1 = await mk(p1.id, a.id, addr(11));
  const s2 = await mk(p2.id, a.id, addr(12));
  const s3 = await mk(p1.id, b.id, addr(13));
  await sql`UPDATE subscriptions SET status = 'active', started_at = to_timestamp(${T0}) WHERE id = ${s1.id}`;
  await sql`UPDATE subscriptions SET status = 'canceled', ended_reason = 'canceled', started_at = to_timestamp(${T0}), canceled_at = to_timestamp(${T0 + 83}), settled_seconds = 83 WHERE id = ${s2.id}`;
  const i1 = await insertInvoice({ merchantId: m.merchantId, livemode, subscriptionId: s1.id, customerId: a.id, periodStart: T0, periodEnd: T0 + 300, seconds: 300, amountWei: 1_200_000n, feeWei: 12_000n, status: "paid", txHash: "0x" + "1".repeat(64), logIndex: 0, chainEventId: null });
  const i2 = await insertInvoice({ merchantId: m.merchantId, livemode, subscriptionId: s1.id, customerId: a.id, periodStart: T0 + 300, periodEnd: T0 + 600, seconds: 300, amountWei: 1_200_000n, feeWei: 12_000n, status: "paid", txHash: "0x" + "2".repeat(64), logIndex: 0, chainEventId: null });
  return { p1, p2, a, b, s1, s2, s3, i1, i2 };
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
});

describe("FR-API-041 subscriptions.list", () => {
  it("FR_API_041_lists_newest_first_with_status_customer_and_product_filters", async () => {
    const f = await seed();
    const all = await api("GET", "/v1/subscriptions", { key: m.skTest });
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ object: "list", has_more: false, url: "/v1/subscriptions" });
    expect(all.body.data.map((s: any) => s.id)).toEqual([f.s3.id, f.s2.id, f.s1.id]);
    expect((await api("GET", "/v1/subscriptions?status=active", { key: m.skTest })).body.data.map((s: any) => s.id)).toEqual([f.s1.id]);
    expect((await api("GET", `/v1/subscriptions?customer=${f.a.id}`, { key: m.skTest })).body.data.map((s: any) => s.id)).toEqual([f.s2.id, f.s1.id]);
    expect((await api("GET", `/v1/subscriptions?product=${f.p1.id}`, { key: m.skTest })).body.data.map((s: any) => s.id)).toEqual([f.s3.id, f.s1.id]);
    const bad = await api("GET", "/v1/subscriptions?status=nope", { key: m.skTest });
    expect(bad.status).toBe(400);
    expect(bad.body.error.param).toBe("status");
  });

  it("FR_API_080_paginates_with_starting_after", async () => {
    const f = await seed();
    const first = await api("GET", "/v1/subscriptions?limit=2", { key: m.skTest });
    expect(first.body.data.map((s: any) => s.id)).toEqual([f.s3.id, f.s2.id]);
    expect(first.body.has_more).toBe(true);
    const second = await api("GET", `/v1/subscriptions?limit=2&starting_after=${f.s2.id}`, { key: m.skTest });
    expect(second.body.data.map((s: any) => s.id)).toEqual([f.s1.id]);
    expect(second.body.has_more).toBe(false);
    expect((await api("GET", "/v1/subscriptions?starting_after=sub_nope", { key: m.skTest })).status).toBe(400);
    expect((await api("GET", "/v1/subscriptions", { key: m.skLive })).body.data).toEqual([]);
  });
});

describe("FR-API-020/021 customers", () => {
  it("FR_API_021_retrieve_and_list_customers", async () => {
    const f = await seed();
    const one = await api("GET", `/v1/customers/${f.a.id}`, { key: m.skTest });
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ id: f.a.id, object: "customer", email: "a@example.com", wallet_address: addr(1), default_payment: "ausd", livemode: false, created: expect.any(Number) });
    const list = await api("GET", "/v1/customers", { key: m.skTest });
    expect(list.body.data.map((c: any) => c.id)).toEqual([f.b.id, f.a.id]);
    const other = await seedMerchant();
    expect((await api("GET", `/v1/customers/${f.a.id}`, { key: other.skTest })).status).toBe(404);
    expect((await api("GET", `/v1/customers/${f.a.id}`, { key: m.pkTest })).status).toBe(401);
  });

  it("FR_API_020_one_customer_per_merchant_mode_and_wallet", async () => {
    const a1 = await insertCustomer({ merchantId: m.merchantId, livemode: false, walletAddress: addr(1).toUpperCase().replace("0X", "0x") });
    const a2 = await insertCustomer({ merchantId: m.merchantId, livemode: false, walletAddress: addr(1) });
    const live = await insertCustomer({ merchantId: m.merchantId, livemode: true, walletAddress: addr(1) });
    expect(a2.id).toBe(a1.id);
    expect(live.id).not.toBe(a1.id);
  });
});

describe("FR-API-052 invoices", () => {
  it("FR_API_052_retrieve_and_list_with_subscription_and_customer_filters", async () => {
    const f = await seed();
    const one = await api("GET", `/v1/invoices/${f.i1.id}`, { key: m.skTest });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: f.i1.id, object: "invoice", subscription: f.s1.id, customer: f.a.id, seconds: 300, amount_settled: "1.2", gross: "1.2", fee: "0.012", net: "1.188", status: "paid", period_start: T0, period_end: T0 + 300 });
    const list = await api("GET", `/v1/invoices?subscription=${f.s1.id}`, { key: m.skTest });
    expect(list.body.data.map((i: any) => i.id)).toEqual([f.i2.id, f.i1.id]);
    expect((await api("GET", `/v1/invoices?customer=${f.b.id}`, { key: m.skTest })).body.data).toEqual([]);
    expect((await api("GET", `/v1/invoices?limit=1`, { key: m.skTest })).body.has_more).toBe(true);
    expect((await api("GET", `/v1/invoices/${f.i1.id}`, { key: m.skLive })).status).toBe(404);
  });
});
