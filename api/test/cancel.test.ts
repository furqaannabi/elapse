import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, encodeAbiParameters, hashMessage } from "viem";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { cancelInnerHash } from "../src/chain/cancel-auth";
import { STREAM, streamCreated, deposited, streamStarted, txHash } from "./ingest-fixtures";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
const INGEST = { authorization: "Bearer ingest-test-token" };

/** A session whose stream is live on chain (fake): prepare, start, then ingest the start logs. */
async function liveSession() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600, wallet_address: subscriber.address } });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  await api("POST", "/internal/ingest", { headers: INGEST, body: { ...streamCreated(tx), args: { ...streamCreated(tx).args, subscriber: subscriber.address.toLowerCase() } } });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted(tx) });
  return { sessionId: s.body.id as string, subId: prep.body.subscription as string };
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-CON-017 cancel authorisation digest", () => {
  it("FR_CON_017_inner_hash_matches_abi_encode_of_ElapseCancel_chainid_stream_nonce_deadline", () => {
    const inner = cancelInnerHash({ chainId: 10143, stream: STREAM, nonce: 2n, deadline: 1_757_000_600n });
    const expected = keccak256(encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      ["ElapseCancel", 10143n, STREAM, 2n, 1_757_000_600n],
    ));
    expect(inner).toBe(expected);
    // The wallet signs EIP-191 over the 32 raw bytes; the contract's cancelDigest is exactly hashMessage({raw}).
    expect(hashMessage({ raw: inner })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("FR-API-032 subscriber cancel through the session", () => {
  it("FR_CHK_008_cancel_prepare_returns_the_message_then_cancel_submits_cancelFor", async () => {
    const { sessionId, subId } = await liveSession();
    chain.setCancelNonce(STREAM, 0n);
    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel/prepare`, { key: m.pkTest, body: {} });
    expect(prep.status).toBe(200);
    expect(prep.body).toMatchObject({ subscription: subId, stream_address: STREAM, chain_id: 10143, nonce: "0" });
    expect(prep.body.message).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Number(prep.body.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000) + 500);

    const signature = await subscriber.signMessage({ message: { raw: prep.body.message } });
    const res = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel`, { key: m.pkTest, body: { signature, deadline: prep.body.deadline } });
    expect(res.status).toBe(202);
    expect(res.body.pending_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.cancels).toEqual([{ stream: STREAM, deadline: BigInt(prep.body.deadline), signature }]);
    // Status is still active until StreamCanceled is ingested (BR-API-005).
    const pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(pub.body.subscription.status).toBe("active");
  });

  it("FR_API_032_a_cancel_signature_from_a_stranger_is_400_and_never_reaches_the_chain", async () => {
    const { sessionId } = await liveSession();
    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel/prepare`, { key: m.pkTest, body: {} });
    const stranger = privateKeyToAccount(generatePrivateKey());
    const signature = await stranger.signMessage({ message: { raw: prep.body.message } });
    const res = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel`, { key: m.pkTest, body: { signature, deadline: prep.body.deadline } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_signature");
    expect(chain.cancels).toHaveLength(0);
  });

  it("FR_API_032_cancel_before_the_stream_is_active_is_409", async () => {
    const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
    const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
    const r = await api("POST", `/v1/checkout/sessions/${s.body.id}/cancel/prepare`, { key: m.pkTest, body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_running");
  });
});
