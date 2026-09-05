import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { STREAM, streamCreated, deposited, streamStarted, streamCanceled, settled, T0 } from "./ingest-fixtures";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
const INGEST = { authorization: "Bearer ingest-test-token" };

async function liveSubscription() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600, wallet_address: subscriber.address } });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamCreated(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted(tx) });
  return { subId: prep.body.subscription as string, customerId: prep.body.customer as string, productId: p.body.id as string };
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-API-041 retrieve", () => {
  it("FR_API_041_retrieve_returns_the_FR_API_040_object_and_404_across_merchants", async () => {
    const { subId, customerId, productId } = await liveSubscription();
    const r = await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: subId, object: "subscription", status: "active", product: productId, customer: customerId, rate_usd_per_second: "0.004", max_escrow_usd: "14.4", funded_usd: "14.4", stream_address: STREAM, chain_id: 10143, currency: "ausd", livemode: false });
    expect(r.body.seconds_elapsed).toBeGreaterThanOrEqual(0);
    const other = await seedMerchant();
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: other.skTest })).status).toBe(404);
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skLive })).status).toBe(404);
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.pkTest })).status).toBe(401);
  });
});

describe("FR-API-042 merchant cancel", () => {
  it("FR_API_042_cancel_submits_through_the_keeper_and_returns_202_with_the_unchanged_subscription", async () => {
    const { subId } = await liveSubscription();
    const r = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: subId, object: "subscription", status: "active" });
    expect(r.body.pending_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.keeperCancels).toEqual([STREAM]);
    // Still active until StreamCanceled is ingested (BR-API-005).
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.status).toBe("active");
    const tx = r.body.pending_tx as string;
    await api("POST", "/internal/ingest", { headers: INGEST, body: settled(83, "332000", "3320", T0 + 83, tx) });
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 83, 83, "332000", "14068000", tx) });
    const after = await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest });
    expect(after.body).toMatchObject({ status: "canceled", ended_reason: "canceled", seconds_elapsed: 83, settled_usd: "0.332" });
  });

  it("FR_API_042_cancel_of_an_incomplete_or_canceled_subscription_is_409", async () => {
    const { subId } = await liveSubscription();
    const tx = "0x" + "ab".repeat(32);
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 10, 10, "40000", "14360000", tx) });
    const r = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_running");
    expect(chain.keeperCancels).toEqual([]);
  });
});
