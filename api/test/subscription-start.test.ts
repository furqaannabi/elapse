import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { streamCreated, deposited } from "./ingest-fixtures";
import { privyFixture } from "./privy-fixture";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
let privy: Awaited<ReturnType<typeof privyFixture>>;
const identity = async (wallet = subscriber.address) => ({ "x-privy-token": await privy.token(wallet) });
const INGEST = { authorization: "Bearer ingest-test-token" };

/** A merchant-mode product authorised by the subscriber: funded on chain, deliberately not started. */
async function authorisedNotStarted() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "Sandbox", rate_usd_per_second: "0.004", start_mode: "merchant" } });
  expect(p.body.start_mode).toBe("merchant");
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600 }, headers: await identity() });
  const signature = await subscriber.signTypedData({
    domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit",
    message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) },
  });
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

describe("FR-CON-019 authorising a merchant-mode product does not start the meter", () => {
  it("funds the stream, completes the session, and leaves the subscription incomplete", async () => {
    const { subId, sessionId } = await authorisedNotStarted();

    // The factory was asked for the no-start path.
    expect(chain.creates[0]?.noStart).toBe(true);

    const sub = await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest });
    expect(sub.body.status).toBe("incomplete");
    expect(sub.body.started_at).toBeNull();

    // FR-API-033: the subscriber is finished, so the session must not be preparable again.
    const cs = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.skTest });
    expect(cs.body.status).toBe("complete");
  });
});

describe("FR-API-049 the merchant starts the meter", () => {
  it("submits start as keeper and answers 202 with pending_tx", async () => {
    const { subId } = await authorisedNotStarted();

    const r = await api("POST", `/v1/subscriptions/${subId}/start`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(r.body.pending_tx).toMatch(/^0x/);
    expect(chain.keeperStarts).toHaveLength(1);
  });

  it("refuses a second start with 409", async () => {
    const { subId } = await authorisedNotStarted();
    await api("POST", `/v1/subscriptions/${subId}/start`, { key: m.skTest });
    const again = await api("POST", `/v1/subscriptions/${subId}/start`, { key: m.skTest });
    expect(again.status).toBe(409);
    expect(chain.keeperStarts).toHaveLength(1);
  });

  it("does not leak another merchant's subscription", async () => {
    const { subId } = await authorisedNotStarted();
    const other = await seedMerchant();
    const r = await api("POST", `/v1/subscriptions/${subId}/start`, { key: other.skTest });
    expect(r.status).toBe(404);
    expect(chain.keeperStarts).toHaveLength(0);
  });
});
