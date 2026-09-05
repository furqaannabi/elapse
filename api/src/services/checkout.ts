/**
 * Checkout session actions (FR-API-032, FR-API-033; ADR 2026-09-04 subscriber permit).
 *
 * `prepareSession`: bind the subscriber's wallet to the session as a Customer, create (or
 * re-cap) the `incomplete` Subscription, and return the ERC-2612 permit the wallet must sign
 * for exactly `maxEscrow`. `startSession`: check the signature recovers to that wallet, mint
 * MockUSD in test mode when the wallet is short, submit `createWithPermit` through the relayer,
 * and record `pending_tx`. `active` arrives from ingest, never from here (BR-API-005).
 */
import type { Address, Hex } from "viem";
import { sql } from "../db/client";
import type { CheckoutSessionRow } from "../db/checkout-sessions";
import { insertCustomer } from "../db/customers";
import { getPayoutAddress } from "../db/merchants";
import { findProduct } from "../db/products";
import { findSubscription, insertSubscription, type SubscriptionRow } from "../db/subscriptions";
import { chainClient } from "../chain/relayer";
import { deploymentFor, escrowTokenFor } from "../chain/deployments";
import { buildPermitTypedData, recoverPermitSigner, splitSignature, PERMIT_TYPES, type PermitDomain } from "../chain/permit";
import { baseUnitsToDecimal } from "../lib/money";
import { config } from "../config";

export const PERMIT_TTL_SECONDS = 600;
const MIN_CAP = 60;
const MAX_CAP = 2_592_000;

export type CheckoutErrorCode =
  | "session_not_open"
  | "cap_fixed"
  | "invalid_cap"
  | "not_prepared"
  | "already_started"
  | "bad_signature"
  | "permit_expired"
  | "no_payout_address";

/** Route layer maps: 409 for `already_started`/`session_not_open`, 400 otherwise. */
export class CheckoutStateError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Wire form of the permit: uint256s as decimal strings (BR-API-004); wallets accept it as-is. */
export interface PermitPayload {
  domain: PermitDomain;
  types: typeof PERMIT_TYPES;
  primaryType: "Permit";
  message: { owner: Address; spender: Address; value: string; nonce: string; deadline: string };
}

export interface PrepareResult {
  customer: string;
  subscription: string;
  chain_id: number;
  max_duration_seconds: number;
  max_escrow_usd: string;
  permit: PermitPayload;
}

export async function prepareSession(input: {
  session: CheckoutSessionRow;
  walletAddress: string;
  email: string | null;
  maxDurationSeconds: number;
  now?: number;
}): Promise<PrepareResult> {
  const { session } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (session.status !== "open" || session.expires_at.getTime() / 1000 <= now) {
    throw new CheckoutStateError("session_not_open", "This checkout session is no longer open.");
  }
  if (session.max_duration_seconds !== null && input.maxDurationSeconds !== session.max_duration_seconds) {
    throw new CheckoutStateError("cap_fixed", "The merchant fixed the duration for this session.");
  }
  if (!Number.isInteger(input.maxDurationSeconds) || input.maxDurationSeconds < MIN_CAP || input.maxDurationSeconds > MAX_CAP) {
    throw new CheckoutStateError("invalid_cap", `max_duration_seconds must be between ${MIN_CAP} and ${MAX_CAP}.`);
  }
  const product = await findProduct(session.merchant_id, session.livemode, session.product_id);
  if (!product || !product.active) throw new CheckoutStateError("session_not_open", "The product is no longer available.");

  const chainId = session.livemode ? config.chains.live : config.chains.test;
  const rate = BigInt(product.rate_per_second_wei);
  const maxEscrow = rate * BigInt(input.maxDurationSeconds);
  const wallet = input.walletAddress.toLowerCase() as Address;

  const sub = await sql.begin(async (tx) => {
    const customer = await insertCustomer({ merchantId: session.merchant_id, livemode: session.livemode, walletAddress: wallet, email: input.email }, tx);
    let sub: SubscriptionRow | null = session.subscription_id ? await findSubscription(session.merchant_id, session.livemode, session.subscription_id, tx) : null;
    if (sub && sub.status !== "incomplete") throw new CheckoutStateError("already_started", "This session has already started.");
    if (sub && sub.customer_id !== customer.id) sub = null; // a different wallet signed in: start a fresh subscription row
    if (sub && sub.pending_tx) throw new CheckoutStateError("already_started", "This session has already started.");
    if (sub) {
      await tx`UPDATE subscriptions SET max_duration_seconds = ${input.maxDurationSeconds}, max_escrow_wei = ${maxEscrow.toString()}::numeric, updated_at = now() WHERE id = ${sub.id}`;
      sub = (await findSubscription(session.merchant_id, session.livemode, sub.id, tx))!;
    } else {
      sub = await insertSubscription(
        {
          merchantId: session.merchant_id, livemode: session.livemode, productId: product.id, customerId: customer.id, checkoutSessionId: session.id,
          chainId, ratePerSecondWei: rate, maxDurationSeconds: input.maxDurationSeconds, maxEscrowWei: maxEscrow,
        },
        tx,
      );
    }
    await tx`UPDATE checkout_sessions SET customer_id = ${customer.id}, subscription_id = ${sub.id}, updated_at = now() WHERE id = ${session.id}`;
    return sub;
  });

  const token = escrowTokenFor(chainId);
  const chain = chainClient();
  const [domain, nonce] = await Promise.all([chain.readPermitDomain(chainId, token), chain.readNonce(chainId, token, wallet)]);
  const deadline = BigInt(now + PERMIT_TTL_SECONDS);
  const td = buildPermitTypedData({ domain, owner: wallet, spender: deploymentFor(chainId).factory, value: maxEscrow, nonce, deadline });
  await sql`UPDATE subscriptions SET permit_nonce = ${nonce.toString()}::numeric, permit_deadline = to_timestamp(${Number(deadline)}) WHERE id = ${sub.id}`;

  return {
    customer: sub.customer_id,
    subscription: sub.id,
    chain_id: chainId,
    max_duration_seconds: input.maxDurationSeconds,
    max_escrow_usd: baseUnitsToDecimal(maxEscrow, config.tokenDecimals),
    permit: {
      domain: td.domain,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: { owner: wallet, spender: td.message.spender, value: maxEscrow.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
    },
  };
}

export async function startSession(input: { session: CheckoutSessionRow; signature: string; now?: number }): Promise<{ subscription: string; pending_tx: Hex }> {
  const { session } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!session.subscription_id || !session.customer_id) throw new CheckoutStateError("not_prepared", "Call prepare before start.");
  const sub = await findSubscription(session.merchant_id, session.livemode, session.subscription_id);
  if (!sub) throw new CheckoutStateError("not_prepared", "Call prepare before start.");
  if (sub.status !== "incomplete" || sub.pending_tx) throw new CheckoutStateError("already_started", "This session has already started.");
  const [permitRow] = await sql`SELECT permit_nonce::text AS nonce, extract(epoch FROM permit_deadline)::bigint AS deadline FROM subscriptions WHERE id = ${sub.id}`;
  if (!permitRow?.nonce || !permitRow.deadline) throw new CheckoutStateError("not_prepared", "Call prepare before start.");
  const deadline = BigInt(permitRow.deadline);
  if (deadline <= BigInt(now)) throw new CheckoutStateError("permit_expired", "The permit expired; call prepare again.");

  const [customer] = await sql`SELECT wallet_address FROM customers WHERE id = ${sub.customer_id}`;
  const wallet = customer!.wallet_address as Address;
  const payout = await getPayoutAddress(session.merchant_id);
  if (!payout) throw new CheckoutStateError("no_payout_address", "The merchant has not set a payout address.");

  const chainId = sub.chain_id;
  const token = escrowTokenFor(chainId);
  const maxEscrow = BigInt(sub.max_escrow_wei);
  const chain = chainClient();
  const domain = await chain.readPermitDomain(chainId, token);
  const td = buildPermitTypedData({ domain, owner: wallet, spender: deploymentFor(chainId).factory, value: maxEscrow, nonce: BigInt(permitRow.nonce), deadline });
  const signer = await recoverPermitSigner(td, input.signature);
  if (signer !== wallet.toLowerCase()) throw new CheckoutStateError("bad_signature", "The signature does not match the subscriber's wallet.");

  // Test mode: the relayer tops the wallet up with MockUSD so no one hunts for a faucet (Undecided 4).
  if (!session.livemode) {
    const balance = await chain.readBalance(chainId, token, wallet);
    if (balance < maxEscrow) await chain.mintMock(chainId, token, wallet, maxEscrow);
  }

  const { v, r, s } = splitSignature(input.signature);
  const pendingTx = await chain.createWithPermit({
    chainId, merchant: payout as Address, subscriber: wallet, token, ratePerSecond: BigInt(sub.rate_per_second_wei), maxEscrow, deadline, v, r, s,
  });
  // Written immediately so ingest can bind StreamCreated by tx hash before the receipt is read (FR-API-071 note).
  await sql`UPDATE subscriptions SET pending_tx = ${pendingTx.toLowerCase()}, updated_at = now() WHERE id = ${sub.id}`;
  return { subscription: sub.id, pending_tx: pendingTx };
}
