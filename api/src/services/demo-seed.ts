/**
 * `demo:seed` (FR-API-154, ADR 2026-10-02 demo account): give the demo merchant a real history.
 *
 * Idempotent setup — the demo merchant (onboarded, paying out to the faucet wallet so the test AUSD
 * its meters settle flows back into the faucet), two test products and one webhook endpoint
 * pointing at the API's own sink (FR-API-155), each marked `demo_seed` for the reset (FR-WRK-076).
 *
 * Then real meters, on testnet, through the very services a subscriber's checkout calls: a wallet
 * generated in memory is funded by one faucet drop, signs each permit and each cancel, and is
 * forgotten when the process exits. Nothing is inserted to look like history: every Subscription,
 * Invoice, Event and Delivery comes from the chain through the indexer, so every tx link is real.
 * The key is never written or logged; leftover AUSD stays stranded on testnet.
 */
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { sql } from "../db/client";
import { findCheckoutSessionById, insertCheckoutSession } from "../db/checkout-sessions";
import { ensureDemoMerchant } from "../db/demo";
import { insertProduct } from "../db/products";
import { insertWebhookEndpoint } from "../db/webhook-endpoints";
import { escrowTokenFor } from "../chain/deployments";
import { FAUCET_DROP_UNITS, faucetClient } from "../chain/faucet";
import { PERMIT_TYPES } from "../chain/permit";
import { chainClient } from "../chain/relayer";
import { decimalToBaseUnits } from "../lib/money";
import { cancelSubscription, prepareCancel, prepareSession, startSession } from "./checkout";
import { dropFaucet } from "./faucet";

export const SEED_PRODUCTS = {
  gpu: { name: "GPU time", rate: "0.004" },
  inference: { name: "Inference API", rate: "0.0005" },
} as const;

export interface SeedMeter {
  product: keyof typeof SEED_PRODUCTS;
  capSeconds: number;
  /** Seconds before the subscriber cancels; `null` lets the meter run into its cap. */
  cancelAfterSeconds: number | null;
}

/** Escrow together ≈ $3.21, well inside one 15 AUSD drop; every session refunds what it did not use. */
export const SEED_METERS: readonly SeedMeter[] = [
  { product: "inference", capSeconds: 60, cancelAfterSeconds: null }, // ends at its cap: the dashboard shows a cap ending
  { product: "gpu", capSeconds: 300, cancelAfterSeconds: 45 },
  { product: "inference", capSeconds: 600, cancelAfterSeconds: 20 },
  { product: "gpu", capSeconds: 300, cancelAfterSeconds: 90 },
  { product: "gpu", capSeconds: 120, cancelAfterSeconds: 30 },
];

/** The Customer's email on every seed meter: an address that can never receive mail. */
const SEED_SUBSCRIBER_EMAIL = "subscriber@demo.elapse.invalid";

export interface SeedOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Resolves once the indexer has made this Subscription active. Defaults to polling Postgres. */
  awaitActive?: (subscriptionId: string) => Promise<void>;
  log?: (line: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function seedDemo(opts: SeedOptions = {}): Promise<void> {
  const sleep = opts.sleep ?? realSleep;
  const log = opts.log ?? ((l: string) => console.log(l));
  const awaitActive = opts.awaitActive ?? ((id: string) => pollActive(id, sleep));

  const faucet = faucetClient();
  if (!faucet) throw new Error("demo:seed funds its meters from the testnet faucet: set FAUCET_PRIVATE_KEY.");

  const merchant = await ensureDemoMerchant();
  await sql`UPDATE merchants SET onboarded_at = COALESCE(onboarded_at, now()), payout_address = ${faucet.address.toLowerCase()} WHERE id = ${merchant.id}`;
  const products = await ensureSeedProducts(merchant.id);
  await ensureSeedEndpoint(merchant.id);
  log(`demo merchant ${merchant.id}: products and endpoint ready`);

  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = account.address;
  await dropFaucet({ livemode: false, wallet, ip: null, merchantId: merchant.id, via: "dashboard", exempt: true });
  await waitForFunds(wallet, sleep);
  log("seed subscriber funded");

  const ordered = [...SEED_METERS].sort((a, b) => Number(a.cancelAfterSeconds !== null) - Number(b.cancelAfterSeconds !== null));
  for (const meter of ordered) {
    const productId = products[meter.product];
    const session = await insertCheckoutSession({
      merchantId: merchant.id, livemode: false, productId, successUrl: `${config.dashboardOrigin}/dashboard`, cancelUrl: `${config.dashboardOrigin}/dashboard`,
      maxDurationSeconds: meter.capSeconds, ttlSeconds: 3600,
    });
    const prep = await prepareSession({ session, walletAddress: wallet, email: SEED_SUBSCRIBER_EMAIL, maxDurationSeconds: meter.capSeconds });
    const m = prep.permit.message;
    const signature = await account.signTypedData({
      domain: { ...prep.permit.domain, verifyingContract: prep.permit.domain.verifyingContract as Address },
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: { owner: m.owner as Address, spender: m.spender as Address, value: BigInt(m.value), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) },
    });
    await startSession({ session: (await findCheckoutSessionById(session.id))!, signature });
    await awaitActive(prep.subscription);
    log(`${prep.subscription} running (${SEED_PRODUCTS[meter.product].name}, cap ${meter.capSeconds}s)`);
    if (meter.cancelAfterSeconds === null) continue;

    await sleep(meter.cancelAfterSeconds * 1000);
    const live = (await findCheckoutSessionById(session.id))!;
    const relay = await prepareCancel({ session: live, walletAddress: wallet });
    const cancelSig = await account.signMessage({ message: { raw: relay.message } });
    await cancelSubscription({ session: live, signature: cancelSig, deadline: relay.deadline });
    log(`${prep.subscription} canceled after ${meter.cancelAfterSeconds}s`);
  }
}

/**
 * The seed products, found or created. A seed product is recognised by `demo_seed` and its rate —
 * never its name, which a judge may change; a product's rate cannot change after creation.
 */
export async function ensureSeedProducts(merchantId: string): Promise<Record<keyof typeof SEED_PRODUCTS, string>> {
  const out = {} as Record<keyof typeof SEED_PRODUCTS, string>;
  for (const [key, p] of Object.entries(SEED_PRODUCTS) as Array<[keyof typeof SEED_PRODUCTS, (typeof SEED_PRODUCTS)[keyof typeof SEED_PRODUCTS]]>) {
    const [found] = await sql`SELECT id FROM products WHERE merchant_id = ${merchantId} AND NOT livemode AND demo_seed AND rate_usd_per_second = ${p.rate}::numeric ORDER BY created_at LIMIT 1`;
    if (found) {
      out[key] = found.id;
      continue;
    }
    const row = await insertProduct({
      merchantId, livemode: false, name: p.name, description: null, rateUsdPerSecond: p.rate, ratePerSecondWei: decimalToBaseUnits(p.rate, config.tokenDecimals)!, allowPause: false, // the seed rates are fixed decimal strings
    });
    await sql`UPDATE products SET demo_seed = true WHERE id = ${row.id}`;
    out[key] = row.id;
  }
  return out;
}

/** The URL the seed endpoint delivers to: the API's own sink. */
export const demoSinkUrl = () => `${config.publicApiUrl}/v1/demo/webhooks`;

/** The seed endpoint, found or created, delivering to the sink. */
export async function ensureSeedEndpoint(merchantId: string): Promise<void> {
  const [found] = await sql`SELECT id FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND NOT livemode AND demo_seed`;
  if (found) return;
  const ep = await insertWebhookEndpoint({ merchantId, livemode: false, url: demoSinkUrl(), events: ["*"], actor: "demo_seed" });
  await sql`UPDATE webhook_endpoints SET demo_seed = true WHERE id = ${ep.row.id}`;
}

/** The drop is broadcast, not confirmed: wait until the wallet can fund every meter's cap. */
async function waitForFunds(wallet: Address, sleep: (ms: number) => Promise<void>): Promise<void> {
  const chainId = config.chains.test;
  const token = escrowTokenFor(chainId);
  for (let i = 0; i < 60; i += 1) {
    if ((await chainClient().readBalance(chainId, token, wallet)) >= FAUCET_DROP_UNITS) return;
    await sleep(2_000);
  }
  throw new Error("The faucet drop did not land within two minutes.");
}

async function pollActive(subscriptionId: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    const [row] = await sql`SELECT status FROM subscriptions WHERE id = ${subscriptionId}`;
    if (row?.status === "active") return;
    await sleep(2_000);
  }
  throw new Error(`${subscriptionId} did not become active within three minutes: is the indexer running?`);
}
