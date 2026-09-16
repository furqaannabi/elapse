/**
 * Subscriber-side reads (FR-API-121): everything a wallet may see about its own meters, across
 * merchants, joined to the public branding only. Never keys, endpoints, payout addresses or
 * other customers' rows.
 */
import { sql } from "./client";
import { findSubscription, serializeSubscription, type SubscriptionRow } from "./subscriptions";
import { baseUnitsToDecimal } from "../lib/money";
import { config } from "../config";
import { startBy } from "../worker/unstarted";

/** Values the `status` filter accepts (FR-API-121). */
export const ACCOUNT_STATUSES = ["active", "paused", "canceled"] as const;
/**
 * What a row can be. `incomplete` appears only in the unfiltered list and only as held money
 * (FR-API-138): merchant mode, funded, not started. It is not a filter value.
 */
export const ACCOUNT_ROW_STATUSES = [...ACCOUNT_STATUSES, "incomplete"] as const;
export type AccountStatus = (typeof ACCOUNT_ROW_STATUSES)[number];

interface AccountRow extends SubscriptionRow {
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_support_url: string | null;
  receipt_emailed_at: Date | null;
  restarted_as: string | null;
  product_allow_pause: boolean | null;
}

const COLS = sql`s.id, s.merchant_id, s.livemode, s.product_id, s.customer_id, s.checkout_session_id, s.status, s.start_mode, s.start_submitted_at, s.cancel_submitted_at, s.ended_reason, s.chain_id,
  s.stream_address, s.pending_tx, s.rate_per_second_wei::text AS rate_per_second_wei, s.max_duration_seconds,
  s.max_escrow_wei::text AS max_escrow_wei, s.funded_wei::text AS funded_wei, s.settled_wei::text AS settled_wei,
  s.settled_fee_wei::text AS settled_fee_wei, s.settled_seconds, s.paused_seconds, s.started_at, s.paused_at, s.canceled_at, s.simulated, s.created_at,
  s.receipt_emailed_at,
  (SELECT n.id FROM checkout_sessions n WHERE n.again_of = s.checkout_session_id ORDER BY n.created_at DESC LIMIT 1) AS restarted_as,
  p.name AS product_name,
  p.allow_pause AS product_allow_pause,
  COALESCE(m.branding->>'display_name', m.name) AS merchant_name,
  m.branding->>'logo_url' AS merchant_logo_url,
  m.branding->>'support_url' AS merchant_support_url`;

/** The wallet's subscriptions in the given statuses, newest start first. At most 200. */
export async function listAccountSubscriptions(walletAddress: string, statuses: readonly AccountStatus[]): Promise<AccountRow[]> {
  const rows = await sql`
    SELECT ${COLS}
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN products p ON p.id = s.product_id
    JOIN merchants m ON m.id = s.merchant_id
    WHERE c.wallet_address = ${walletAddress.toLowerCase()} AND s.status = ANY(${sql.array([...statuses], "TEXT")})
      AND (s.status <> 'incomplete' OR (s.start_mode = 'merchant' AND s.stream_address IS NOT NULL AND s.funded_wei > 0))
    ORDER BY s.started_at DESC NULLS LAST, s.created_at DESC
    LIMIT 200`;
  return rows as unknown as AccountRow[];
}

/** One subscription, only if it belongs to the wallet; null otherwise (a stranger gets a 404, never a 403). */
export async function findAccountSubscription(walletAddress: string, id: string): Promise<AccountRow | null> {
  const [row] = await sql`
    SELECT ${COLS}
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN products p ON p.id = s.product_id
    JOIN merchants m ON m.id = s.merchant_id
    WHERE s.id = ${id} AND c.wallet_address = ${walletAddress.toLowerCase()}`;
  return (row as unknown as AccountRow | undefined) ?? null;
}

/** The wire shape of FR-API-121: the subscription's public figures plus the merchant's public branding. */
export function serializeAccountSubscription(row: AccountRow, now = Math.floor(Date.now() / 1000)) {
  const s = serializeSubscription(row, now);
  const d = config.tokenDecimals;
  const refunded = row.status === "canceled" ? BigInt(row.funded_wei) - BigInt(row.settled_wei) : 0n;
  return {
    id: s.id,
    object: "subscription" as const,
    status: s.status as AccountStatus,
    livemode: s.livemode,
    checkout_session: row.checkout_session_id,
    restarted_as: row.restarted_as,
    merchant: { name: row.merchant_name, logo_url: row.merchant_logo_url, support_url: row.merchant_support_url },
    product: { name: row.product_name ?? "", rate_usd_per_second: s.rate_usd_per_second, allow_pause: Boolean(row.product_allow_pause) },
    started_at: s.started_at,
    paused_at: s.paused_at,
    canceled_at: s.canceled_at,
    ended_reason: s.ended_reason,
    max_duration_seconds: s.max_duration_seconds,
    funded_usd: s.funded_usd,
    settled_usd: s.settled_usd,
    refunded_usd: baseUnitsToDecimal(refunded < 0n ? 0n : refunded, d),
    seconds_elapsed: s.seconds_elapsed,
    start_mode: row.start_mode,
    start_by: startBy(row),
  };
}

export { findSubscription };
