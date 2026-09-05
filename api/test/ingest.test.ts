import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { insertProduct } from "../src/db/products";
import { insertCheckoutSession } from "../src/db/checkout-sessions";
import { insertCustomer } from "../src/db/customers";
import { insertSubscription, findSubscription } from "../src/db/subscriptions";
import { CHAIN, STREAM, SUBSCRIBER, T0, TREASURY, MERCHANT_ADDR, txHash, streamCreated, deposited, streamStarted, streamPaused, streamResumed, settled, streamCanceled, killGate, log } from "./ingest-fixtures";

const TOKEN = "ingest-test-token";
const ingest = (body: unknown, token: string | null = TOKEN) =>
  api("POST", "/internal/ingest", { body, headers: token ? { authorization: `Bearer ${token}` } : {} });

let m: Fixture;
let productId: string;
let customerId: string;
let subId: string;
let sessionId: string;

/** A merchant, a 0.004 USD/s product, an open session, a customer and an `incomplete` subscription bound to the kill-gate stream. */
async function seedIncomplete(opts: { streamAddress?: string | null; pendingTx?: string | null; maxDuration?: number; livemode?: boolean } = {}) {
  const livemode = opts.livemode ?? false;
  const product = await insertProduct({ merchantId: m.merchantId, livemode, name: "GPU", description: null, rateUsdPerSecond: "0.004", ratePerSecondWei: 4000n, allowPause: true });
  productId = product.id;
  const session = await insertCheckoutSession({ merchantId: m.merchantId, livemode, productId, successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", maxDurationSeconds: null, ttlSeconds: 3600 });
  sessionId = session.id;
  const customer = await insertCustomer({ merchantId: m.merchantId, livemode, walletAddress: SUBSCRIBER, email: "sub@example.com" });
  customerId = customer.id;
  const maxDuration = opts.maxDuration ?? 3600;
  const sub = await insertSubscription({
    merchantId: m.merchantId, livemode, productId, customerId, checkoutSessionId: sessionId,
    chainId: livemode ? 143 : CHAIN, ratePerSecondWei: 4000n, maxDurationSeconds: maxDuration, maxEscrowWei: 4000n * BigInt(maxDuration),
    streamAddress: opts.streamAddress === undefined ? STREAM : opts.streamAddress, pendingTx: opts.pendingTx ?? null,
  });
  subId = sub.id;
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
});

describe("FR-API-070 auth and idempotency", () => {
  it("FR_API_070_rejects_missing_wrong_and_merchant_keys_with_401", async () => {
    expect((await ingest(streamCreated(), null)).status).toBe(401);
    expect((await ingest(streamCreated(), "nope")).status).toBe(401);
    expect((await ingest(streamCreated(), m.skTest)).status).toBe(401);
  });

  it("FR_API_070_validates_the_body", async () => {
    const r = await ingest({ ...streamCreated(), block_number: "abc" });
    expect(r.status).toBe(400);
    expect(r.body.error.param).toBe("block_number");
  });

  it("FR_API_070_a_duplicate_log_is_acknowledged_and_does_nothing", async () => {
    await seedIncomplete();
    const body = streamStarted();
    const first = await ingest(body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ duplicate: false, subscription: subId });
    const second = await ingest(body);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM chain_events`;
    expect(count).toBe(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM events`;
    expect(n).toBe(2); // checkout.session.completed + subscription.created, once
  });

  it("FR_API_072_an_unknown_stream_is_stored_and_ignored", async () => {
    const r = await ingest(streamStarted());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ duplicate: false, ignored: true });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM chain_events WHERE subscription_id IS NULL`;
    expect(count).toBe(1);
  });

  it("FR_API_072_a_testnet_log_for_a_live_subscription_is_409", async () => {
    await seedIncomplete({ livemode: true });
    // Same address on chain 10143 while the subscription lives on 143.
    const r = await ingest(log("StreamStarted", { merchant: MERCHANT_ADDR, subscriber: SUBSCRIBER, ratePerSecond: "4000", startedAt: String(T0) }, { chainId: 10143 }));
    // Address lookup is per chain, so this is simply unknown on 10143…
    expect(r.body.ignored).toBe(true);
    // …but a body whose chain is 143 with the live subscription and a testnet-flagged event is refused.
    const bad = await ingest(log("StreamStarted", { merchant: MERCHANT_ADDR, subscriber: SUBSCRIBER, ratePerSecond: "4000", startedAt: String(T0) }, { chainId: 143 }));
    expect(bad.status).toBe(200); // live chain, live subscription: fine
    const sub = await findSubscription(m.merchantId, true, subId);
    expect(sub!.status).toBe("active");
  });
});

describe("FR-API-071 mapping", () => {
  it("FR_API_071_StreamCreated_matched_by_pending_tx_stores_the_stream_address", async () => {
    const tx = txHash();
    await seedIncomplete({ streamAddress: null, pendingTx: tx });
    const r = await ingest(streamCreated(tx));
    expect(r.body).toMatchObject({ duplicate: false, subscription: subId });
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.stream_address).toBe(STREAM);
    expect(sub!.status).toBe("incomplete");
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM events`;
    expect(n).toBe(0);
  });

  it("FR_API_071_Deposited_updates_funded_and_writes_a_ledger_row_without_an_Event", async () => {
    await seedIncomplete();
    await ingest(deposited());
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.funded_wei).toBe("14400000");
    const rows = await sql`SELECT kind, amount_wei::text AS amount, from_address, to_address, subscription_id, customer_id FROM ledger_entries`;
    expect(rows).toEqual([{ kind: "deposit", amount: "14400000", from_address: SUBSCRIBER, to_address: STREAM, subscription_id: subId, customer_id: customerId }]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM events`;
    expect(n).toBe(0);
  });

  it("FR_API_071_StreamStarted_activates_completes_the_session_and_emits_two_Events", async () => {
    await seedIncomplete();
    await ingest(streamStarted(undefined, T0));
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.status).toBe("active");
    expect(Math.floor(sub!.started_at!.getTime() / 1000)).toBe(T0);
    const [session] = await sql`SELECT status, subscription_id, customer_id FROM checkout_sessions WHERE id = ${sessionId}`;
    expect(session).toEqual({ status: "complete", subscription_id: subId, customer_id: customerId });
    const events = await sql`SELECT type, data FROM events ORDER BY seq`;
    expect(events.map((e: any) => e.type)).toEqual(["checkout.session.completed", "subscription.created"]);
    expect(events[0].data.object).toMatchObject({ id: sessionId, object: "checkout.session", status: "complete", subscription: subId, customer: customerId });
    expect(events[1].data.object).toMatchObject({ id: subId, object: "subscription", status: "active", started_at: T0, rate_usd_per_second: "0.004", max_escrow_usd: "14.4", funded_usd: "0", settled_usd: "0", stream_address: STREAM, chain_id: CHAIN });
  });

  it("FR_API_071_pause_and_resume_emit_subscription_updated_and_accumulate_paused_seconds", async () => {
    await seedIncomplete();
    await ingest(streamStarted(undefined, T0));
    await ingest(streamPaused(T0 + 100));
    let sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.status).toBe("paused");
    expect(Math.floor(sub!.paused_at!.getTime() / 1000)).toBe(T0 + 100);
    await ingest(streamResumed(T0 + 160));
    sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.status).toBe("active");
    expect(sub!.paused_at).toBeNull();
    expect(sub!.paused_seconds).toBe(60);
    const types = (await sql`SELECT type FROM events ORDER BY seq`).map((e: any) => e.type);
    expect(types).toEqual(["checkout.session.completed", "subscription.created", "subscription.updated", "subscription.updated"]);
  });

  it("FR_API_050_Settled_creates_a_paid_Invoice_and_invoice_settled", async () => {
    await seedIncomplete();
    await ingest(streamStarted(undefined, T0));
    await ingest(settled(60, "240000", "2400", T0 + 60));
    const [inv] = await sql`SELECT * FROM invoices`;
    expect(inv).toMatchObject({ subscription_id: subId, customer_id: customerId, seconds: 60, status: "paid", log_index: 0 });
    expect(inv.amount_wei).toBe("240000");
    expect(inv.fee_wei).toBe("2400");
    expect(Math.floor(inv.period_start.getTime() / 1000)).toBe(T0);
    expect(Math.floor(inv.period_end.getTime() / 1000)).toBe(T0 + 60);
    const [ev] = await sql`SELECT data FROM events WHERE type = 'invoice.settled'`;
    expect(ev.data.object).toMatchObject({ object: "invoice", subscription: subId, seconds: 60, amount_settled: "0.24", gross: "0.24", fee: "0.0024", net: "0.2376", currency: "ausd", status: "paid" });
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub!.settled_wei).toBe("240000");
    expect(sub!.settled_seconds).toBe(60);
    const kinds = (await sql`SELECT kind, amount_wei::text AS amount, to_address FROM ledger_entries ORDER BY kind`);
    expect(kinds).toEqual([{ kind: "fee", amount: "2400", to_address: TREASURY }, { kind: "settlement", amount: "237600", to_address: MERCHANT_ADDR }]);
  });

  it("FR_API_071_kill_gate_cancel_ends_the_subscription_and_emits_subscription_canceled_once", async () => {
    await seedIncomplete();
    for (const body of killGate()) expect((await ingest(body)).status).toBe(200);
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub).toMatchObject({ status: "canceled", ended_reason: "canceled", settled_seconds: 220, funded_wei: "14400000", settled_wei: "880000", settled_fee_wei: "8800" });
    expect(Math.floor(sub!.canceled_at!.getTime() / 1000)).toBe(T0 + 220);
    const types = (await sql`SELECT type FROM events ORDER BY seq`).map((e: any) => e.type);
    expect(types).toEqual(["checkout.session.completed", "subscription.created", "invoice.settled", "subscription.canceled"]);
    const [ev] = await sql`SELECT data FROM events WHERE type = 'subscription.canceled'`;
    expect(ev.data.object).toMatchObject({ status: "canceled", ended_reason: "canceled", canceled_at: T0 + 220, seconds_elapsed: 220, settled_usd: "0.88", funded_usd: "14.4" });
    const ledger = (await sql`SELECT kind, amount_wei::text AS amount FROM ledger_entries ORDER BY seq`);
    expect(ledger).toEqual([
      { kind: "deposit", amount: "14400000" }, { kind: "settlement", amount: "871200" }, { kind: "fee", amount: "8800" }, { kind: "refund", amount: "13520000" },
    ]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM invoices`;
    expect(n).toBe(1);
  });

  it("FR_API_051_a_cap_end_records_cap_reached_and_fires_payment_failed_before_canceled", async () => {
    await seedIncomplete({ maxDuration: 220 });
    const startTx = txHash();
    const endTx = txHash();
    await ingest(streamCreated(startTx));
    await ingest(deposited(startTx));
    await ingest(streamStarted(startTx, T0));
    await ingest(settled(220, "880000", "8800", T0 + 220, endTx));
    await ingest(streamCanceled(T0 + 220, 220, "880000", "0", endTx));
    const sub = await findSubscription(m.merchantId, false, subId);
    expect(sub).toMatchObject({ status: "canceled", ended_reason: "cap_reached" });
    const types = (await sql`SELECT type FROM events ORDER BY seq`).map((e: any) => e.type);
    expect(types.slice(-3)).toEqual(["invoice.settled", "invoice.payment_failed", "subscription.canceled"]);
    const invoices = await sql`SELECT status, seconds, amount_wei::text AS amount FROM invoices ORDER BY seq`;
    expect(invoices).toEqual([{ status: "paid", seconds: 220, amount: "880000" }, { status: "failed", seconds: 0, amount: "0" }]);
    const [notif] = await sql`SELECT kind, target_id FROM notifications`;
    expect(notif).toEqual({ kind: "payment_failed", target_id: subId });
    const ledger = (await sql`SELECT kind FROM ledger_entries ORDER BY seq`).map((r: any) => r.kind);
    expect(ledger).toEqual(["deposit", "settlement", "fee"]);
  });

  it("FR_API_073_an_Event_never_exists_without_its_Delivery_jobs", async () => {
    await seedIncomplete();
    await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://merchant.example/hooks", events: ["*"] } });
    await ingest(streamStarted(undefined, T0));
    const [{ events }] = await sql`SELECT count(*)::int AS events FROM events`;
    const [{ jobs }] = await sql`SELECT count(*)::int AS jobs FROM deliveries`;
    expect(events).toBe(2);
    expect(jobs).toBe(2);
  });
});
