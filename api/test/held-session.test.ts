import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { STREAM, streamCreated, deposited } from "./ingest-fixtures";
import { privyFixture } from "./privy-fixture";
import { UNSTARTED_WINDOW_S, runUnstartedSweepOnce } from "../src/worker/unstarted";

/**
 * FR-API-137/138 (signed 2026-09-16): what the subscriber sees of a merchant-mode session they have
 * authorised and funded but the merchant has not started yet — the held state.
 */

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
let privy: Awaited<ReturnType<typeof privyFixture>>;
const identity = async (wallet = subscriber.address) => ({ "x-privy-token": await privy.token(wallet) });
const INGEST = { authorization: "Bearer ingest-test-token" };

/** Authorised and funded on a merchant-mode product, never started: prepare, start, ingest create + deposit only. */
async function heldSession(opts: { maxDuration?: number; startMode?: "checkout" | "merchant"; funded?: boolean } = {}) {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "Lambda", rate_usd_per_second: "0.002", start_mode: opts.startMode ?? "merchant" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: opts.maxDuration ?? 3600 }, headers: await identity() });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: BigInt(prep.body.permit.message.nonce ?? 0), deadline: BigInt(prep.body.permit.message.deadline) } });
  if (opts.funded === false) return { sessionId: s.body.id as string, subId: prep.body.subscription as string };
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  await api("POST", "/internal/ingest", { headers: INGEST, body: { ...streamCreated(tx), args: { ...streamCreated(tx).args, subscriber: subscriber.address.toLowerCase() } } });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  return { sessionId: s.body.id as string, subId: prep.body.subscription as string };
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

describe("FR-API-137 start mode and refund-by time for the subscriber", () => {
  it("FR_API_137_the_public_session_of_a_held_subscription_carries_start_mode_and_the_sweep_cutoff", async () => {
    const { sessionId, subId } = await heldSession();
    const created: number = (await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.created;

    const pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(pub.status).toBe(200);
    expect(pub.body.subscription.status).toBe("incomplete");
    expect(pub.body.subscription.start_mode).toBe("merchant");
    // The same window the FR-WRK-075 sweep refunds on: min(max_duration_seconds, UNSTARTED_WINDOW_S).
    expect(pub.body.subscription.start_by).toBe(created + Math.min(3600, UNSTARTED_WINDOW_S));
  });
  it("FR_API_137_the_subscriber_can_stop_a_held_session_and_the_sweep_never_cancels_it_again", async () => {
    const { sessionId, subId } = await heldSession();
    chain.setRelayNonce(STREAM, 0n);

    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel/prepare`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(prep.status).toBe(200);
    expect(prep.body).toMatchObject({ subscription: subId, stream_address: STREAM });
    const signature = await subscriber.signMessage({ message: { raw: prep.body.message } });
    const res = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel`, { key: m.pkTest, body: { signature, deadline: prep.body.deadline } });
    expect(res.status).toBe(202);
    expect(chain.cancels.map((c) => c.stream)).toEqual([STREAM]);

    // Long past the window: the sweep would refund it, but the subscriber's cancel is already in flight.
    const swept = await runUnstartedSweepOnce({ now: Math.floor(Date.now() / 1000) + 86_400, log: () => {} });
    expect(swept.canceled).toEqual([]);
    expect(chain.keeperCancels).toEqual([]);
  });
});

describe("FR-API-137 the product's start mode before anything is authorised", () => {
  it("FR_API_137_the_public_session_product_says_whether_billing_waits_for_the_merchant", async () => {
    for (const mode of ["merchant", "checkout"] as const) {
      const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: `P ${mode}`, rate_usd_per_second: "0.002", start_mode: mode } });
      const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
      const pub = await api("GET", `/v1/checkout/sessions/${s.body.id}`, { key: m.pkTest });
      // No subscription yet: the cap step reads the mode from the product (checkout FR-CHK-035).
      expect(pub.body.subscription).toBeNull();
      expect(pub.body.product.start_mode).toBe(mode);
    }
  });
});

describe("FR-API-138 /account lists held money", () => {
  it("FR_API_138_lists_a_funded_unstarted_merchant_row_with_its_refund_time_and_hides_other_incomplete_rows", async () => {
    const held = await heldSession();
    const unfunded = await heldSession({ funded: false });
    const checkoutMode = await heldSession({ startMode: "checkout" });

    const r = await api("GET", "/v1/account/subscriptions", { headers: await identity() });
    expect(r.status).toBe(200);
    const ids = r.body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(held.subId);
    expect(ids).not.toContain(unfunded.subId);
    expect(ids).not.toContain(checkoutMode.subId);

    const row = r.body.data.find((d: { id: string }) => d.id === held.subId);
    const created: number = (await api("GET", `/v1/subscriptions/${held.subId}`, { key: m.skTest })).body.created;
    expect(row).toMatchObject({ status: "incomplete", start_mode: "merchant", start_by: created + Math.min(3600, UNSTARTED_WINDOW_S) });
  });

  it("FR_API_138_the_account_stops_a_held_meter_and_the_sweep_never_cancels_it_again", async () => {
    const held = await heldSession();
    chain.setRelayNonce(STREAM, 0n);
    const prep = await api("POST", `/v1/account/subscriptions/${held.subId}/cancel/prepare`, { body: {}, headers: await identity() });
    expect(prep.status).toBe(200);
    const signature = await subscriber.signMessage({ message: { raw: prep.body.message } });
    const res = await api("POST", `/v1/account/subscriptions/${held.subId}/cancel`, { body: { signature, deadline: prep.body.deadline }, headers: await identity() });
    expect(res.status).toBe(202);
    expect(chain.cancels.map((c) => c.stream)).toEqual([STREAM]);
    const swept = await runUnstartedSweepOnce({ now: Math.floor(Date.now() / 1000) + 86_400, log: () => {} });
    expect(swept.canceled).toEqual([]);
  });
});
