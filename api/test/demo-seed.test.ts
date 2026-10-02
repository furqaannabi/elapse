/**
 * FR-API-154: `demo:seed` (ADR 2026-10-02 demo account). It finds or creates the demo merchant, its
 * two products and its webhook endpoint, then runs real test meters through the same checkout
 * services a subscriber's checkout uses, from a wallet generated in memory and funded by one
 * faucet drop.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./helpers";
import { sql } from "../src/db/client";
import { setChainClient } from "../src/chain/relayer";
import { setFaucetClient, type FaucetClient } from "../src/chain/faucet";
import { SEED_METERS, seedDemo } from "../src/services/demo-seed";
import { fakeChain } from "./fake-chain";
import { fakeFaucet } from "./fake-faucet";

let chain: ReturnType<typeof fakeChain>;
let faucet: ReturnType<typeof fakeFaucet>;
let streams = 0;

/** What the indexer does when StreamCreated/StreamStarted land: the meter becomes active on its stream. */
async function indexerMarksActive(subscriptionId: string) {
  streams += 1;
  await sql`UPDATE subscriptions SET status = 'active', started_at = now(), pending_tx = NULL,
            stream_address = ${"0x" + streams.toString(16).padStart(40, "0")} WHERE id = ${subscriptionId}`;
}

const run = () => seedDemo({ sleep: async () => {}, awaitActive: indexerMarksActive, log: () => {} });

beforeEach(async () => {
  await resetDb();
  chain = fakeChain();
  setChainClient(chain.client);
  faucet = fakeFaucet();
  // The drop lands on chain: the fake faucet's transfer credits the fake chain's AUSD balance.
  const client: FaucetClient = {
    ...faucet.client,
    async transfer(to, units) {
      const hash = await faucet.client.transfer(to, units);
      chain.balances.set(to.toLowerCase(), (chain.balances.get(to.toLowerCase()) ?? 0n) + units);
      return hash;
    },
    balanceOf: async (who) => chain.balances.get(who.toLowerCase()) ?? 0n,
  };
  setFaucetClient(client);
});
afterEach(() => {
  setChainClient(null);
  setFaucetClient(null);
});

describe("FR-API-154 demo:seed", () => {
  it("FR_API_154_creates_the_demo_merchant_its_products_and_its_endpoint_once_across_two_runs", async () => {
    await run();
    await run();
    const merchants = await sql`SELECT id, name, onboarded_at IS NOT NULL AS onboarded, payout_address FROM merchants WHERE demo`;
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({ name: "Acme Cloud (demo)", onboarded: true });
    // Settlements pay the faucet wallet, so the test AUSD the meters spend flows back to the faucet.
    expect(merchants[0]!.payout_address).toBe(faucet.client.address.toLowerCase());
    const products = await sql`SELECT name, rate_usd_per_second::text AS rate, demo_seed FROM products WHERE NOT livemode ORDER BY name`;
    expect(products).toEqual([
      { name: "GPU time", rate: "0.004000000000000000", demo_seed: true },
      { name: "Inference API", rate: "0.000500000000000000", demo_seed: true },
    ]);
    const endpoints = await sql`SELECT url, events, demo_seed FROM webhook_endpoints`;
    expect(endpoints).toEqual([{ url: "http://localhost:4000/v1/demo/webhooks", events: ["*"], demo_seed: true }]);
  });

  it("FR_API_154_runs_real_meters_through_the_checkout_services_and_cancels_most", async () => {
    await run();
    expect(chain.creates).toHaveLength(SEED_METERS.length);
    const toCancel = SEED_METERS.filter((m) => m.cancelAfterSeconds !== null).length;
    expect(chain.cancels).toHaveLength(toCancel);
    expect(SEED_METERS.some((m) => m.cancelAfterSeconds === null)).toBe(true); // one runs to its cap
    // One subscriber wallet, funded by one faucet drop recorded against the demo merchant.
    const subscribers = new Set(chain.creates.map((c) => c.subscriber.toLowerCase()));
    expect(subscribers.size).toBe(1);
    expect(faucet.transfers).toEqual([{ to: [...subscribers][0]!, units: 15_000_000n }]);
    const [drop] = await sql`SELECT d.merchant_id, m.demo FROM faucet_drops d JOIN merchants m ON m.id = d.merchant_id`;
    expect(drop!.demo).toBe(true);
    // Every meter is a Subscription of the demo merchant with a Customer behind it.
    const subs = await sql`SELECT s.status FROM subscriptions s JOIN merchants m ON m.id = s.merchant_id WHERE m.demo`;
    expect(subs).toHaveLength(SEED_METERS.length);
  });

  it("FR_API_154_the_meters_together_fit_inside_one_15_AUSD_drop", () => {
    const rate = { gpu: 0.004, inference: 0.0005 } as const;
    const escrow = SEED_METERS.reduce((sum, m) => sum + rate[m.product] * m.capSeconds, 0);
    expect(escrow).toBeLessThan(15);
    expect(SEED_METERS.length).toBeGreaterThanOrEqual(4);
    expect(SEED_METERS.length).toBeLessThanOrEqual(6);
    for (const m of SEED_METERS) if (m.cancelAfterSeconds !== null) expect(m.cancelAfterSeconds).toBeGreaterThanOrEqual(20), expect(m.cancelAfterSeconds).toBeLessThanOrEqual(90);
  });

  it("FR_API_154_refuses_to_run_without_the_faucet", async () => {
    setFaucetClient(null);
    await expect(run()).rejects.toThrow(/faucet/i);
  });
});
