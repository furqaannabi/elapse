import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { streamStarted, log } from "./ingest-fixtures";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());

async function newSession(extra: Record<string, unknown> = {}) {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no", ...extra } });
  return s.body.id as string;
}

async function signPermit(permit: any) {
  return subscriber.signTypedData({
    domain: permit.domain, types: permit.types, primaryType: "Permit",
    message: { owner: permit.message.owner, spender: permit.message.spender, value: BigInt(permit.message.value), nonce: BigInt(permit.message.nonce), deadline: BigInt(permit.message.deadline) },
  });
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-API-032 routes", () => {
  it("FR_API_032_prepare_needs_a_publishable_key_and_validates_the_body", async () => {
    const id = await newSession();
    expect((await api("POST", `/v1/checkout/sessions/${id}/prepare`, { body: { max_duration_seconds: 60, wallet_address: subscriber.address } })).status).toBe(401);
    const bad = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 60, wallet_address: "nope" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.param).toBe("wallet_address");
    const short = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 5, wallet_address: subscriber.address } });
    expect(short.status).toBe(400);
    expect(short.body.error.param).toBe("max_duration_seconds");
  });

  it("FR_API_032_prepare_then_start_returns_202_with_pending_tx_and_the_session_shows_the_subscription", async () => {
    const id = await newSession();
    const prep = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600, wallet_address: subscriber.address, email: "s@example.com" } });
    expect(prep.status).toBe(200);
    expect(prep.body).toMatchObject({ chain_id: 10143, max_escrow_usd: "14.4", max_duration_seconds: 3600 });
    expect(prep.body.permit.message.value).toBe("14400000");

    const signature = await signPermit(prep.body.permit);
    const start = await api("POST", `/v1/checkout/sessions/${id}/start`, { key: m.pkTest, body: { signature } });
    expect(start.status).toBe(202);
    const tx: string = start.body.pending_tx; // read before toMatchObject: Bun's matcher mutates the received object
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(start.body.subscription).toBe(prep.body.subscription);

    const pub = await api("GET", `/v1/checkout/sessions/${id}`, { key: m.pkTest });
    expect(pub.body.status).toBe("open");
    expect(pub.body.customer).toEqual({ id: prep.body.customer, email: "s@example.com" });
    expect(pub.body.subscription).toMatchObject({ id: prep.body.subscription, status: "incomplete", max_escrow_usd: "14.4", seconds_elapsed: 0 });
    expect(pub.body.subscription.stream_address).toBeNull();

    // The chain confirms: ingest binds the stream by pending_tx, the session completes, the page sees `active`.
    const created = log("StreamCreated", { stream: "0x86776c5be46d01242285aac66040b3bf0634cd8a", merchant: m.payoutAddress, subscriber: subscriber.address.toLowerCase(), token: "0xb162dfde7073eb1b4dd6279efcd0568e9c09a21c", ratePerSecond: "4000", maxEscrow: "14400000" }, { address: "0x656fa8b348981602acf36fad07804e806cc15d5b", tx, logIndex: 0 });
    const ing = await api("POST", "/internal/ingest", { body: created, headers: { authorization: "Bearer ingest-test-token" } });
    expect(ing.body.subscription).toBe(prep.body.subscription);
    await api("POST", "/internal/ingest", { body: streamStarted(tx), headers: { authorization: "Bearer ingest-test-token" } });
    const after = await api("GET", `/v1/checkout/sessions/${id}`, { key: m.pkTest });
    expect(after.body.status).toBe("complete");
    expect(after.body.subscription).toMatchObject({ status: "active", stream_address: "0x86776c5be46d01242285aac66040b3bf0634cd8a" });
    const full = await api("GET", `/v1/checkout/sessions/${id}`, { key: m.skTest });
    expect(full.body.subscription).toBe(prep.body.subscription); // ids on the merchant object, like Stripe
    expect(full.body.customer).toBe(prep.body.customer);
  });

  it("FR_API_032_error_codes_map_to_400_and_409", async () => {
    const id = await newSession({ max_duration_seconds: 900 });
    const fixed = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600, wallet_address: subscriber.address } });
    expect(fixed.status).toBe(400);
    expect(fixed.body.error.code).toBe("cap_fixed");
    const notPrepared = await api("POST", `/v1/checkout/sessions/${id}/start`, { key: m.pkTest, body: { signature: "0x" + "11".repeat(65) } });
    expect(notPrepared.status).toBe(400);
    expect(notPrepared.body.error.code).toBe("not_prepared");

    const prep = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 900, wallet_address: subscriber.address } });
    const other = privateKeyToAccount(generatePrivateKey());
    const wrong = await other.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: 3_600_000n, nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
    const bad = await api("POST", `/v1/checkout/sessions/${id}/start`, { key: m.pkTest, body: { signature: wrong } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("bad_signature");

    const ok = await api("POST", `/v1/checkout/sessions/${id}/start`, { key: m.pkTest, body: { signature: await signPermit(prep.body.permit) } });
    expect(ok.status).toBe(202);
    const again = await api("POST", `/v1/checkout/sessions/${id}/start`, { key: m.pkTest, body: { signature: await signPermit(prep.body.permit) } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_started");
    const reprep = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 900, wallet_address: subscriber.address } });
    expect(reprep.status).toBe(409);
  });

  it("FR_API_032_a_session_of_another_merchant_is_404", async () => {
    const id = await newSession();
    const other = await seedMerchant();
    const r = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: other.pkTest, body: { max_duration_seconds: 60, wallet_address: subscriber.address } });
    expect(r.status).toBe(404);
  });

  it("FR_API_032_start_without_a_relayer_is_503_api_error", async () => {
    setChainClient(null);
    const id = await newSession();
    const r = await api("POST", `/v1/checkout/sessions/${id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 60, wallet_address: subscriber.address } });
    expect(r.status).toBe(503);
    expect(r.body.error.type).toBe("api_error");
  });
});
