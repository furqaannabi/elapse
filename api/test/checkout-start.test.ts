import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sql } from "../src/db/client";
import { resetDb, seedMerchant, type Fixture } from "./helpers";
import { insertProduct } from "../src/db/products";
import { insertCheckoutSession, findCheckoutSession } from "../src/db/checkout-sessions";
import { findSubscription } from "../src/db/subscriptions";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { prepareSession, startSession, CheckoutStateError } from "../src/services/checkout";
import { deploymentFor } from "../src/chain/deployments";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey()); // throwaway wallet, test-only
const NOW = 1_757_000_000;

async function openSession(maxDurationSeconds: number | null = null) {
  const product = await insertProduct({ merchantId: m.merchantId, livemode: false, name: "GPU", description: null, rateUsdPerSecond: "0.004", ratePerSecondWei: 4000n, allowPause: true });
  return insertCheckoutSession({ merchantId: m.merchantId, livemode: false, productId: product.id, successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", maxDurationSeconds, ttlSeconds: 3600 });
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-API-032 prepare", () => {
  it("FR_API_032_prepare_creates_customer_and_incomplete_subscription_and_returns_the_permit_payload", async () => {
    const session = await openSession();
    const out = await prepareSession({ session, walletAddress: subscriber.address, email: "s@example.com", maxDurationSeconds: 3600, now: NOW });
    expect(out.max_escrow_usd).toBe("14.4");
    expect(out.chain_id).toBe(10143);
    expect(out.subscription).toMatch(/^sub_/);
    expect(out.customer).toMatch(/^cus_/);
    const d = deploymentFor(10143);
    expect(out.permit.domain).toEqual({ name: "Mock USD", version: "1", chainId: 10143, verifyingContract: d.mockUsd });
    expect(out.permit.message).toEqual({ owner: subscriber.address.toLowerCase() as `0x${string}`, spender: d.factory, value: "14400000", nonce: "0", deadline: String(NOW + 600) });
    expect(out.permit.primaryType).toBe("Permit");
    const sub = await findSubscription(m.merchantId, false, out.subscription);
    expect(sub).toMatchObject({ status: "incomplete", chain_id: 10143, max_duration_seconds: 3600, max_escrow_wei: "14400000", rate_per_second_wei: "4000", stream_address: null, pending_tx: null });
    const [cus] = await sql`SELECT wallet_address, email FROM customers WHERE id = ${out.customer}`;
    expect(cus).toEqual({ wallet_address: subscriber.address.toLowerCase(), email: "s@example.com" });
    const after = await findCheckoutSession(m.merchantId, false, session.id);
    expect(after).toMatchObject({ customer_id: out.customer, subscription_id: out.subscription, status: "open" });
  });

  it("FR_API_032_prepare_again_replaces_the_cap_and_reuses_the_customer", async () => {
    const session = await openSession();
    const a = await prepareSession({ session, walletAddress: subscriber.address, email: null, maxDurationSeconds: 600, now: NOW });
    const b = await prepareSession({ session: (await findCheckoutSession(m.merchantId, false, session.id))!, walletAddress: subscriber.address, email: null, maxDurationSeconds: 3600, now: NOW });
    expect(b.customer).toBe(a.customer);
    expect(b.subscription).toBe(a.subscription);
    expect(b.max_escrow_usd).toBe("14.4");
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM subscriptions`;
    expect(n).toBe(1);
  });

  it("FR_API_030_a_merchant_fixed_cap_cannot_be_changed_by_the_subscriber", async () => {
    const session = await openSession(900);
    await expect(prepareSession({ session, walletAddress: subscriber.address, email: null, maxDurationSeconds: 3600, now: NOW })).rejects.toBeInstanceOf(CheckoutStateError);
    const out = await prepareSession({ session, walletAddress: subscriber.address, email: null, maxDurationSeconds: 900, now: NOW });
    expect(out.max_escrow_usd).toBe("3.6");
  });

  it("FR_API_033_a_complete_or_expired_session_cannot_be_prepared", async () => {
    const session = await openSession();
    await sql`UPDATE checkout_sessions SET status = 'complete' WHERE id = ${session.id}`;
    const s2 = (await findCheckoutSession(m.merchantId, false, session.id))!;
    await expect(prepareSession({ session: s2, walletAddress: subscriber.address, email: null, maxDurationSeconds: 60, now: NOW })).rejects.toBeInstanceOf(CheckoutStateError);
  });
});

describe("FR-API-032 start", () => {
  async function prepared(maxDuration = 3600) {
    const session = await openSession();
    const out = await prepareSession({ session, walletAddress: subscriber.address, email: null, maxDurationSeconds: maxDuration, now: NOW });
    const signature = await subscriber.signTypedData({
      domain: out.permit.domain,
      types: out.permit.types,
      primaryType: "Permit",
      message: { owner: subscriber.address, spender: out.permit.message.spender, value: BigInt(out.permit.message.value), nonce: BigInt(out.permit.message.nonce), deadline: BigInt(out.permit.message.deadline) },
    });
    return { session: (await findCheckoutSession(m.merchantId, false, session.id))!, out, signature };
  }

  it("FR_API_032_start_mints_in_test_mode_submits_createWithPermit_and_stores_pending_tx", async () => {
    const { session, out, signature } = await prepared();
    const res = await startSession({ session, signature, now: NOW });
    expect(res.pending_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.mints).toEqual([{ to: subscriber.address.toLowerCase(), amount: 14_400_000n }]);
    expect(chain.creates).toHaveLength(1);
    const d = deploymentFor(10143);
    expect(chain.creates[0]).toMatchObject({ chainId: 10143, subscriber: subscriber.address.toLowerCase(), token: d.mockUsd, ratePerSecond: 4000n, maxEscrow: 14_400_000n, deadline: BigInt(NOW + 600) });
    expect(chain.creates[0]!.merchant.toLowerCase()).toBe(m.payoutAddress.toLowerCase());
    const sub = await findSubscription(m.merchantId, false, out.subscription);
    expect(sub).toMatchObject({ status: "incomplete", pending_tx: res.pending_tx });
  });

  it("FR_API_032_start_skips_the_mint_when_the_wallet_already_holds_enough", async () => {
    chain.balances.set(subscriber.address.toLowerCase(), 20_000_000n);
    const { session, signature } = await prepared();
    await startSession({ session, signature, now: NOW });
    expect(chain.mints).toEqual([]);
  });

  it("FR_API_032_a_signature_from_another_wallet_is_400", async () => {
    const { session, out } = await prepared();
    const other = privateKeyToAccount(generatePrivateKey());
    const bad = await other.signTypedData({
      domain: out.permit.domain, types: out.permit.types, primaryType: "Permit",
      message: { owner: subscriber.address, spender: out.permit.message.spender, value: 14_400_000n, nonce: 0n, deadline: BigInt(NOW + 600) },
    });
    await expect(startSession({ session, signature: bad, now: NOW })).rejects.toMatchObject({ code: "bad_signature" });
    expect(chain.creates).toHaveLength(0);
  });

  it("FR_API_032_an_expired_permit_is_400", async () => {
    const { session, signature } = await prepared();
    await expect(startSession({ session, signature, now: NOW + 601 })).rejects.toMatchObject({ code: "permit_expired" });
  });

  it("FR_API_032_a_second_start_is_409", async () => {
    const { session, signature } = await prepared();
    await startSession({ session, signature, now: NOW });
    const again = (await findCheckoutSession(m.merchantId, false, session.id))!;
    await expect(startSession({ session: again, signature, now: NOW })).rejects.toMatchObject({ code: "already_started" });
    expect(chain.creates).toHaveLength(1);
  });

  it("FR_API_032_start_needs_a_merchant_payout_address", async () => {
    const { session, signature } = await prepared();
    await sql`UPDATE merchants SET payout_address = NULL WHERE id = ${m.merchantId}`;
    await expect(startSession({ session, signature, now: NOW })).rejects.toMatchObject({ code: "no_payout_address" });
    expect(chain.creates).toHaveLength(0);
  });

  it("FR_API_032_start_without_prepare_is_400", async () => {
    const session = await openSession();
    await expect(startSession({ session, signature: "0x" + "11".repeat(65), now: NOW })).rejects.toMatchObject({ code: "not_prepared" });
  });
});
