import type { SQL } from "bun";
import { sql } from "./client";
import { newId } from "../lib/ids";
import { baseUnitsToDecimal } from "../lib/money";
import { config } from "../config";
import { keysetList } from "../lib/keyset";

/** FR-API-040 storage row. Money columns arrive as decimal strings of base units (numeric → text). */
export interface SubscriptionRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  product_id: string;
  customer_id: string;
  checkout_session_id: string | null;
  status: "incomplete" | "active" | "paused" | "canceled";
  ended_reason: "canceled" | "cap_reached" | null;
  chain_id: number;
  stream_address: string | null;
  pending_tx: string | null;
  rate_per_second_wei: string;
  max_duration_seconds: number;
  max_escrow_wei: string;
  funded_wei: string;
  settled_wei: string;
  settled_fee_wei: string;
  settled_seconds: number;
  paused_seconds: number;
  started_at: Date | null;
  paused_at: Date | null;
  canceled_at: Date | null;
  simulated: boolean;
  created_at: Date;
}

const COLS = sql`id, merchant_id, livemode, product_id, customer_id, checkout_session_id, status, ended_reason, chain_id,
  stream_address, pending_tx, rate_per_second_wei::text AS rate_per_second_wei, max_duration_seconds,
  max_escrow_wei::text AS max_escrow_wei, funded_wei::text AS funded_wei, settled_wei::text AS settled_wei,
  settled_fee_wei::text AS settled_fee_wei, settled_seconds, paused_seconds, started_at, paused_at, canceled_at, simulated, created_at`;

export async function insertSubscription(
  input: {
    merchantId: string;
    livemode: boolean;
    productId: string;
    customerId: string;
    checkoutSessionId: string | null;
    chainId: number;
    ratePerSecondWei: bigint;
    maxDurationSeconds: number;
    maxEscrowWei: bigint;
    streamAddress?: string | null;
    pendingTx?: string | null;
  },
  tx: SQL = sql,
): Promise<SubscriptionRow> {
  const [row] = await tx`
    INSERT INTO subscriptions (id, merchant_id, livemode, product_id, customer_id, checkout_session_id, chain_id,
                               rate_per_second_wei, max_duration_seconds, max_escrow_wei, stream_address, pending_tx)
    VALUES (${newId("sub")}, ${input.merchantId}, ${input.livemode}, ${input.productId}, ${input.customerId}, ${input.checkoutSessionId},
            ${input.chainId}, ${input.ratePerSecondWei.toString()}::numeric, ${input.maxDurationSeconds}, ${input.maxEscrowWei.toString()}::numeric,
            ${input.streamAddress?.toLowerCase() ?? null}, ${input.pendingTx?.toLowerCase() ?? null})
    RETURNING ${COLS}`;
  return row as SubscriptionRow;
}

export async function findSubscription(merchantId: string, livemode: boolean, id: string, tx: SQL = sql): Promise<SubscriptionRow | null> {
  const [row] = await tx`SELECT ${COLS} FROM subscriptions WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as SubscriptionRow) ?? null;
}

/**
 * Ingest lookup (FR-API-071/072): the stream address once known, else the relayer's tx hash
 * recorded by `start` so `StreamCreated` can bind the address before the receipt is read.
 */
export async function findSubscriptionForLog(chainId: number, address: string, txHash: string, tx: SQL = sql): Promise<SubscriptionRow | null> {
  const [row] = await tx`
    SELECT ${COLS} FROM subscriptions
    WHERE chain_id = ${chainId} AND (stream_address = ${address.toLowerCase()} OR (stream_address IS NULL AND pending_tx = ${txHash.toLowerCase()}))
    ORDER BY (stream_address IS NOT NULL) DESC
    LIMIT 1`;
  return (row as SubscriptionRow) ?? null;
}

const epoch = (d: Date | null): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

/**
 * FR-API-040 wire object. `seconds_elapsed` is `settled_seconds` once the stream has ended and
 * `min(now − started_at − paused, max)` while it runs; callers pass `now` so Events are reproducible.
 */
export function serializeSubscription(row: SubscriptionRow, now = Math.floor(Date.now() / 1000)) {
  const d = config.tokenDecimals;
  const startedAt = epoch(row.started_at);
  let secondsElapsed = 0;
  if (row.status === "canceled") secondsElapsed = row.settled_seconds;
  else if (startedAt !== null) {
    const pausedNow = row.status === "paused" && row.paused_at ? now - epoch(row.paused_at)! : 0;
    secondsElapsed = Math.max(0, Math.min(now - startedAt - row.paused_seconds - pausedNow, row.max_duration_seconds));
  }
  return {
    id: row.id,
    object: "subscription" as const,
    status: row.status,
    product: row.product_id,
    customer: row.customer_id,
    checkout_session: row.checkout_session_id,
    rate_usd_per_second: baseUnitsToDecimal(BigInt(row.rate_per_second_wei), d),
    started_at: startedAt,
    paused_at: epoch(row.paused_at),
    canceled_at: epoch(row.canceled_at),
    ended_reason: row.ended_reason,
    max_duration_seconds: row.max_duration_seconds,
    max_escrow_usd: baseUnitsToDecimal(BigInt(row.max_escrow_wei), d),
    funded_usd: baseUnitsToDecimal(BigInt(row.funded_wei), d),
    settled_usd: baseUnitsToDecimal(BigInt(row.settled_wei), d),
    seconds_elapsed: secondsElapsed,
    stream_address: row.stream_address,
    chain_id: row.chain_id,
    currency: "ausd" as const,
    livemode: row.livemode,
    created: epoch(row.created_at)!,
  };
}

/** FR-API-041 list with optional status / customer / product filters, newest first. */
export async function listSubscriptions(
  merchantId: string,
  livemode: boolean,
  opts: { limit: number; startingAfter?: string | undefined; status?: SubscriptionRow["status"] | undefined; customer?: string | undefined; product?: string | undefined },
): Promise<SubscriptionRow[]> {
  const filters = [];
  if (opts.status) filters.push(sql`status = ${opts.status}`);
  if (opts.customer) filters.push(sql`customer_id = ${opts.customer}`);
  if (opts.product) filters.push(sql`product_id = ${opts.product}`);
  return keysetList<SubscriptionRow>("subscriptions", COLS, sql`merchant_id = ${merchantId} AND livemode = ${livemode}`, filters, opts);
}
