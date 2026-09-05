import { sql } from "./client";
import { newId } from "../lib/ids";

export interface CheckoutSessionRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  product_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  success_url: string;
  cancel_url: string;
  status: "open" | "complete" | "expired";
  expires_at: Date;
  max_duration_seconds: number | null;
  created_at: Date;
}

const COLS = sql`id, merchant_id, livemode, product_id, customer_id, subscription_id, success_url, cancel_url,
  status, expires_at, max_duration_seconds, created_at`;

export async function insertCheckoutSession(input: {
  merchantId: string;
  livemode: boolean;
  productId: string;
  successUrl: string;
  cancelUrl: string;
  maxDurationSeconds: number | null;
  ttlSeconds: number;
}): Promise<CheckoutSessionRow> {
  const id = newId("cs");
  const [row] = await sql`
    INSERT INTO checkout_sessions (id, merchant_id, livemode, product_id, success_url, cancel_url, expires_at, max_duration_seconds)
    VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${input.productId}, ${input.successUrl}, ${input.cancelUrl},
            now() + make_interval(secs => ${input.ttlSeconds}), ${input.maxDurationSeconds})
    RETURNING ${COLS}`;
  return row as CheckoutSessionRow;
}

/**
 * Scoped by merchant and mode. An `open` session past `expires_at` is
 * reported as `expired` on read (FR-API-033); the sweeper persists it later.
 */
export async function findCheckoutSession(merchantId: string, livemode: boolean, id: string): Promise<CheckoutSessionRow | null> {
  const [row] = await sql`
    SELECT ${COLS} FROM checkout_sessions
    WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  if (!row) return null;
  const r = row as CheckoutSessionRow;
  if (r.status === "open" && r.expires_at.getTime() <= Date.now()) r.status = "expired";
  return r;
}
