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
import { getMerchantBranding, getPayoutAddress } from "../db/merchants";
import { findProduct } from "../db/products";
import { findSubscription, insertSubscription, type SubscriptionRow } from "../db/subscriptions";
import { chainClient } from "../chain/relayer";
import { deploymentFor, escrowTokenFor } from "../chain/deployments";
import { buildPermitTypedData, recoverPermitSigner, splitSignature, PERMIT_TYPES, type PermitDomain } from "../chain/permit";
import { relayInnerHash, recoverCancelSigner, type RelayAction } from "../chain/cancel-auth";
import { baseUnitsToDecimal } from "../lib/money";
import { config } from "../config";

export const PERMIT_TTL_SECONDS = 600;
const MIN_CAP = 60;
const MAX_CAP = 2_592_000;

export type CheckoutErrorCode =
  | "merchant_controlled"
  | "not_running"
  | "cancel_in_flight"
  | "invalid_state"
  | "pause_not_allowed"
  | "rate_limited"
  | "session_not_open"
  | "cap_fixed"
  | "invalid_cap"
  | "not_prepared"
  | "already_started"
  | "bad_signature"
  | "permit_expired"
  | "no_payout_address"
  | "not_startable"
  | "not_funded"
  | "subscriber_mismatch"
  | "insufficient_balance";

/** Route layer maps: 409 for `already_started`/`session_not_open`/`not_running`, 403 for `subscriber_mismatch`, 400 otherwise. */
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
          chainId, ratePerSecondWei: rate, maxDurationSeconds: input.maxDurationSeconds, maxEscrowWei: maxEscrow, startMode: product.start_mode,
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

  // FR-API-034 (AUSD only, ADR 2026-09-13): a wallet that cannot fund the cap is refused here,
  // in either mode, before any gas is spent. Nothing is ever minted.
  const balance = await chain.readBalance(chainId, token, wallet);
  if (balance < maxEscrow) {
    throw new CheckoutStateError("insufficient_balance", `This meter needs $${usd(maxEscrow)} to start. Your balance is $${usd(balance)}.`);
  }

  const { v, r, s } = splitSignature(input.signature);
  const pendingTx = await chain.createWithPermit({
    chainId, merchant: payout as Address, subscriber: wallet, token, ratePerSecond: BigInt(sub.rate_per_second_wei), maxEscrow, deadline, v, r, s,
    // FR-CON-019: a merchant-started product funds the stream and leaves it Created.
    noStart: sub.start_mode === "merchant",
  });
  // Written immediately so ingest can bind StreamCreated by tx hash before the receipt is read (FR-API-071 note).
  await sql`UPDATE subscriptions SET pending_tx = ${pendingTx.toLowerCase()}, updated_at = now() WHERE id = ${sub.id}`;
  return { subscription: sub.id, pending_tx: pendingTx };
}

export const CANCEL_TTL_SECONDS = 600;

/**
 * How long a submitted keeper cancel is treated as still in flight (FR-API-042). Inside the window
 * a second Stop is refused, so the relayer never sends a duplicate that reverts and burns gas.
 * After it, a Stop is allowed through again: a relayer transaction that was dropped and never
 * confirmed would otherwise strand the meter until the escrow cap, overcharging the subscriber,
 * which BR-DSH-008 and the settle rules forbid. Wasted gas is the cheaper of the two failures.
 * The same reasoning amended BR-EXM-110 for the example's sweep. **Awaiting Furqaan's review.**
 */
export const CANCEL_RETRY_SECONDS = 300;
/** Pause-or-resume submissions per Subscription per hour (FR-API-047); each is a relayer tx and a merchant webhook. */
export const PAUSE_RESUME_PER_HOUR = 10;

/**
 * FR-API-139: a merchant-mode meter the merchant has started is the merchant's to stop, pause or resume.
 * The contract refuses the subscriber (FR-CON-057); refusing here keeps the relayer from paying for a revert.
 */
export function isMerchantControlled(sub: Pick<SubscriptionRow, "start_mode" | "status">): boolean {
  return sub.start_mode === "merchant" && (sub.status === "active" || sub.status === "paused");
}

/** FR-API-137: authorised and funded in `merchant` mode, but the merchant has not started it. */
export function isHeld(sub: SubscriptionRow): boolean {
  return sub.status === "incomplete" && sub.start_mode === "merchant" && !!sub.stream_address && BigInt(sub.funded_wei) > 0n;
}

/** A Subscription that can be canceled on chain right now: it has a stream and is active or paused. */
async function runningSubscription(session: CheckoutSessionRow): Promise<SubscriptionRow> {
  const sub = session.subscription_id ? await findSubscription(session.merchant_id, session.livemode, session.subscription_id) : null;
  if (!sub || !sub.stream_address || (sub.status !== "active" && sub.status !== "paused")) {
    throw new CheckoutStateError("not_running", "There is no running meter on this session.");
  }
  return sub;
}

/**
 * The Subscription a relayed action may apply to. Cancel is the only one left: the subscriber's
 * pause and resume were withdrawn 2026-09-20 (ADR 2026-09-20), so pausing is the merchant's and
 * goes through the keeper (FR-API-141/142), never a signature from the subscriber.
 */
async function actionableSubscription(session: CheckoutSessionRow, action: RelayAction): Promise<SubscriptionRow> {
  const current = session.subscription_id ? await findSubscription(session.merchant_id, session.livemode, session.subscription_id) : null;
  // FR-API-137 (amended 2026-09-19): a merchant-mode subscription is the merchant's to stop in every
  // state, held included (contracts FR-CON-057). The subscriber's way out of a held session is the
  // unstarted sweep (worker FR-WRK-075) or the merchant itself, and `start_by` tells them when.
  if (current && (isMerchantControlled(current) || isHeld(current))) {
    const merchant = (await getMerchantBranding(session.merchant_id))?.name ?? "the merchant";
    throw new CheckoutStateError("merchant_controlled", `Only ${merchant} can stop this meter.`);
  }
  return runningSubscription(session);
}

/**
 * Step one of a relayed action (FR-CON-017/018, checkout FR-CHK-008/030): the 32 bytes the
 * wallet signs with a personal-sign, bound to this stream, the action, its current nonce and a
 * 10-minute deadline.
 */
export async function prepareRelay(action: RelayAction, input: { session: CheckoutSessionRow; walletAddress: string; now?: number }) {
  const sub = await actionableSubscription(input.session, action);
  // FR-API-120: the identity token must belong to the Customer on this session (403 subscriber_mismatch).
  const [customer] = await sql`SELECT wallet_address FROM customers WHERE id = ${sub.customer_id}`;
  if ((customer!.wallet_address as string).toLowerCase() !== input.walletAddress.toLowerCase()) {
    throw new CheckoutStateError("subscriber_mismatch", "Signed in as a different subscriber.");
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const stream = sub.stream_address as Address;
  const nonce = await chainClient().readRelayNonce(sub.chain_id, stream);
  const deadline = BigInt(now + CANCEL_TTL_SECONDS);
  return {
    subscription: sub.id,
    stream_address: stream,
    chain_id: sub.chain_id,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    message: relayInnerHash(action, { chainId: sub.chain_id, stream, nonce, deadline }),
  };
}

/**
 * Step two: verify the signature is the subscriber's, then the relayer submits
 * `cancelFor` / `pauseFor` / `resumeFor`. The new status arrives via ingest (BR-API-005).
 * Pause and resume are counted per Subscription per hour (FR-API-047) and audited.
 */
export async function submitRelay(action: RelayAction, input: { session: CheckoutSessionRow; signature: string; deadline: string; ip?: string | null; now?: number }): Promise<{ subscription: string; pending_tx: Hex }> {
  const sub = await actionableSubscription(input.session, action);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!/^\d{1,12}$/.test(input.deadline)) throw new CheckoutStateError("permit_expired", "Invalid deadline.");
  const deadline = BigInt(input.deadline);
  if (deadline <= BigInt(now)) throw new CheckoutStateError("permit_expired", `The ${action} authorisation expired; ask for a new message.`);
  const stream = sub.stream_address as Address;
  const chain = chainClient();
  const nonce = await chain.readRelayNonce(sub.chain_id, stream);
  const inner = relayInnerHash(action, { chainId: sub.chain_id, stream, nonce, deadline });
  const [customer] = await sql`SELECT wallet_address FROM customers WHERE id = ${sub.customer_id}`;
  const signer = await recoverCancelSigner(inner, input.signature);
  if (!signer || signer !== (customer!.wallet_address as string).toLowerCase()) {
    throw new CheckoutStateError("bad_signature", "The signature does not match the subscriber's wallet.");
  }
  if (action !== "cancel") {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM audit_log
      WHERE action IN ('subscription.pause', 'subscription.resume') AND target = ${sub.id} AND at > now() - interval '1 hour'`;
    if (n >= PAUSE_RESUME_PER_HOUR) throw new CheckoutStateError("rate_limited", "Too many changes. Try again in a bit.");
  }
  const pendingTx = await chain.cancelFor(sub.chain_id, stream, deadline, input.signature as Hex);
  // Since FR-API-137's 2026-09-19 amendment a subscriber never reaches here with a held session —
  // `actionableSubscription` refuses one — so there is no held cancel to stamp against the sweep.
  await sql`UPDATE subscriptions SET updated_at = now() WHERE id = ${sub.id}`;
  if (action !== "cancel") {
    await sql`INSERT INTO audit_log (merchant_id, actor, action, target, ip) VALUES (${sub.merchant_id}, 'checkout', ${`subscription.${action}`}, ${sub.id}, ${input.ip ?? null})`;
  }
  return { subscription: sub.id, pending_tx: pendingTx };
}

/** Step one of a subscriber cancel (FR-CON-017, checkout FR-CHK-008). */
export function prepareCancel(input: { session: CheckoutSessionRow; walletAddress: string; now?: number }) {
  return prepareRelay("cancel", input);
}

/** Step two of a subscriber cancel: the relayer submits `cancelFor`; `canceled` arrives via ingest. */
export function cancelSubscription(input: { session: CheckoutSessionRow; signature: string; deadline: string; now?: number }) {
  return submitRelay("cancel", input);
}

/** Merchant-initiated cancel (FR-API-042): the relayer is the factory keeper (FR-CON-054) and calls `cancel()` directly. */
/**
 * FR-API-049: start a meter the subscriber has already authorised. Only a `merchant`-mode
 * subscription reaches here unstarted; the relayer submits `start()` as keeper (contracts
 * FR-CON-055) because a merchant's server holds no key. `active` arrives via ingest.
 */
export async function startAsKeeper(sub: SubscriptionRow): Promise<Hex> {
  if (sub.status === "active") throw new CheckoutStateError("already_started", "This meter is already running.");
  // The row stays `incomplete` until StreamStarted ingests, so the marker is what makes this idempotent.
  if (sub.start_submitted_at) throw new CheckoutStateError("already_started", "A start is already in flight for this meter.");
  if (sub.status !== "incomplete") throw new CheckoutStateError("not_startable", "This subscription can no longer be started.");
  if (!sub.stream_address) throw new CheckoutStateError("not_funded", "The subscriber has not authorised this session yet.");
  const pendingTx = await chainClient().start(sub.chain_id, sub.stream_address as Address);
  await sql`UPDATE subscriptions SET pending_tx = ${pendingTx.toLowerCase()}, start_submitted_at = now(), updated_at = now() WHERE id = ${sub.id}`;
  return pendingTx;
}

/**
 * FR-API-141/142: pause or resume a merchant's meter as the factory's keeper (contracts
 * FR-CON-074). No money moves either way and paused seconds are never billed, so the only state
 * that matters is the one the chain will accept: pause needs `active`, resume needs `paused`.
 * Like every other relayed action the row is left alone — the status arrives with the event.
 */
export async function pauseAsKeeper(sub: SubscriptionRow): Promise<Hex> {
  if (!sub.stream_address || sub.status !== "active") {
    throw new CheckoutStateError("not_running", "The subscription has no running meter.");
  }
  return chainClient().pause(sub.chain_id, sub.stream_address as Address);
}

export async function resumeAsKeeper(sub: SubscriptionRow): Promise<Hex> {
  if (!sub.stream_address || sub.status !== "paused") {
    throw new CheckoutStateError("not_running", "The subscription has no paused meter to resume.");
  }
  return chainClient().resume(sub.chain_id, sub.stream_address as Address);
}

export async function cancelAsKeeper(sub: SubscriptionRow, now: number = Date.now()): Promise<Hex> {
  // FR-API-137 (amended 2026-09-19): a held session counts. Since the subscriber can no longer
  // stop one themselves, the merchant must be able to — otherwise the only way their money comes
  // back is the unstarted sweep, and the ADR promises two. Cancelling an unstarted stream refunds
  // the whole deposit (contracts FR-CON-056).
  const releasable = sub.status === "active" || sub.status === "paused" || isHeld(sub);
  if (!sub.stream_address || !releasable) {
    throw new CheckoutStateError("not_running", "The subscription has no running meter.");
  }
  // FR-API-137/138: the row is left as it is until `StreamCanceled` ingests (BR-API-005), so this
  // stamp is the only thing that makes a cancel idempotent. Without it a merchant pressing Stop
  // twice inside the confirmation window sends a second keeper transaction, which reverts and
  // burns gas — the reason the column was added. `startAsKeeper` guards its submit the same way.
  const since = sub.cancel_submitted_at ? now - sub.cancel_submitted_at.getTime() : Infinity;
  if (since < CANCEL_RETRY_SECONDS * 1000) throw new CheckoutStateError("cancel_in_flight", "A stop is already on its way for this meter.");
  const pendingTx = await chainClient().cancel(sub.chain_id, sub.stream_address as Address);
  // Stamped only after the relayer accepted it, so a submission that failed can still be retried.
  await sql`UPDATE subscriptions SET cancel_submitted_at = now(), updated_at = now() WHERE id = ${sub.id}`;
  return pendingTx;
}

/**
 * FR-API-048 (amended 2026-09-13, AUSD only): what the checkout needs to know before the cap
 * step — the wallet's AUSD balance. No token is mintable, so a short wallet funds itself in
 * either mode; `needs_funding` is always true. Names for the one screen that may say them.
 */
export async function readCheckoutBalance(input: { session: CheckoutSessionRow; walletAddress: string }) {
  const chainId = input.session.livemode ? config.chains.live : config.chains.test;
  const token = escrowTokenFor(chainId);
  const wallet = input.walletAddress.toLowerCase() as Address;
  const balance = await chainClient().readBalance(chainId, token, wallet);
  return {
    balance_usd: usd(balance),
    needs_funding: true,
    receive_address: wallet,
    token: "AUSD",
    network: chainId === 143 ? "Monad" : "Monad testnet",
    chain_id: chainId,
  };
}

/** Token base units → "14.40": two decimals for a sentence a subscriber reads (FR-API-034). */
function usd(units: bigint): string {
  const d = baseUnitsToDecimal(units, config.tokenDecimals);
  const [whole, frac = ""] = d.split(".");
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}
