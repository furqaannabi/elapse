import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { STREAM, T0, streamCreated, deposited, streamStarted, settled, streamCanceled } from "./ingest-fixtures";
import { privyFixture } from "./privy-fixture";
import { sql } from "../src/db/client";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
let privy: Awaited<ReturnType<typeof privyFixture>>;
const identity = async (wallet = subscriber.address) => ({ "x-privy-token": await privy.token(wallet, { email: "sub@example.com" }) });
const INGEST = { authorization: "Bearer ingest-test-token" };

async function runningSession(maxDuration?: number) {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok?session_id={CHECKOUT_SESSION_ID}", cancel_url: "https://x.test/no", ...(maxDuration ? { max_duration_seconds: maxDuration } : {}) } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: maxDuration ?? 3600 }, headers: await identity() });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: BigInt(prep.body.permit.message.nonce), deadline: BigInt(prep.body.permit.message.deadline) } });
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  const created = streamCreated(tx);
  await api("POST", "/internal/ingest", { headers: INGEST, body: { ...created, args: { ...created.args, subscriber: subscriber.address.toLowerCase() } } });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted(tx) });
  return { sessionId: s.body.id as string, productId: p.body.id as string, customerId: prep.body.customer as string };
}
async function endIt() {
  const cancelTx = "0x" + "c".repeat(64);
  await api("POST", "/internal/ingest", { headers: INGEST, body: settled(40, "160000", "1600", T0 + 40, cancelTx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 40, 40, "160000", "14240000", cancelTx) });
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain({ balances: { [subscriber.address]: 10_000_000_000n } });
  setChainClient(chain.client);
  privy = await privyFixture();
  privy.use();
});
afterEach(() => {
  setChainClient(null);
  privy.off();
});

describe("FR-API-126 start again", () => {
  it("FR_API_126_an_ended_session_opens_a_copy_for_the_same_customer_with_the_last_cap_and_an_audit_row", async () => {
    const { sessionId, productId, customerId } = await runningSession();
    const running = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(running.status).toBe(409);
    expect(running.body.error.code).toBe("not_ended");
    await endIt();
    const r = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^cs_/);
    expect(r.body.id).not.toBe(sessionId);
    expect(r.body).not.toHaveProperty("url"); // FR-API-140(a): no hosted page to link to
    const pub = await api("GET", `/v1/checkout/sessions/${r.body.id}`, { key: m.pkTest });
    expect(pub.body).toMatchObject({ status: "open", product: { id: productId }, customer: { id: customerId }, subscription: null, max_duration_seconds: null, last_max_duration_seconds: 3600 });
    expect(pub.body.merchant).toMatchObject({ success_url: "https://x.test/ok?session_id={CHECKOUT_SESSION_ID}", cancel_url: "https://x.test/no" });
    const full = await api("GET", `/v1/checkout/sessions/${r.body.id}`, { key: m.skTest });
    expect(full.status).toBe(200);
    // one follow-on per session: the original now points at it and refuses a second
    const orig = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(orig.body.restarted_as).toBe(r.body.id);
    expect(pub.body.restarted_as).toBeNull();
    const twice = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatchObject({ code: "already_restarted" });
    expect(twice.body.error.message).toContain(r.body.id);
    const acct = await api("GET", "/v1/account/subscriptions", { headers: await identity() });
    expect(acct.body.data.find((x: any) => x.checkout_session === sessionId).restarted_as).toBe(r.body.id);
    const [audit] = await sql`SELECT action, target FROM audit_log WHERE action = 'checkout_session.again'`;
    expect(audit).toMatchObject({ action: "checkout_session.again", target: `${sessionId} -> ${r.body.id}` });
  });

  it("FR_API_126_a_merchant_fixed_cap_is_copied_and_an_archived_product_or_a_stranger_is_refused", async () => {
    const { sessionId, productId } = await runningSession(900);
    await endIt();
    const s = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity(stranger.address) });
    expect(s.status).toBe(403);
    const ok = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(ok.status).toBe(201);
    const pub = await api("GET", `/v1/checkout/sessions/${ok.body.id}`, { key: m.pkTest });
    expect(pub.body.max_duration_seconds).toBe(900);
    await api("POST", `/v1/products/${productId}`, { key: m.skTest, body: { active: false } });
    const archived = await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(archived.status).toBe(400);
    expect(archived.body.error).toMatchObject({ code: "product_archived", message: "This product is no longer available." });
    // no token at all
    expect((await api("POST", `/v1/checkout/sessions/${sessionId}/again`, { key: m.pkTest, body: {} })).status).toBe(401);
  });
});
