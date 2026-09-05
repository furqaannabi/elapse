import { sql } from "./client";
import { newId } from "../lib/ids";

export interface ProductRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  name: string;
  description: string | null;
  rate_usd_per_second: string;
  rate_per_second_wei: string;
  allow_pause: boolean;
  active: boolean;
  created_at: Date;
}

const COLS = sql`id, merchant_id, livemode, name, description,
  rate_usd_per_second::text AS rate_usd_per_second, rate_per_second_wei::text AS rate_per_second_wei,
  allow_pause, active, created_at`;

export async function insertProduct(input: {
  merchantId: string;
  livemode: boolean;
  name: string;
  description: string | null;
  rateUsdPerSecond: string;
  ratePerSecondWei: bigint;
  allowPause: boolean;
}): Promise<ProductRow> {
  const id = newId("prod");
  const [row] = await sql`
    INSERT INTO products (id, merchant_id, livemode, name, description, rate_usd_per_second, rate_per_second_wei, allow_pause)
    VALUES (${id}, ${input.merchantId}, ${input.livemode}, ${input.name}, ${input.description},
            ${input.rateUsdPerSecond}::numeric, ${input.ratePerSecondWei.toString()}::numeric, ${input.allowPause})
    RETURNING ${COLS}`;
  return row as ProductRow;
}

/** Scoped by merchant and mode, so another mode's id is simply absent (FR-API-001, FR-API-082). */
export async function findProduct(merchantId: string, livemode: boolean, id: string): Promise<ProductRow | null> {
  const [row] = await sql`
    SELECT ${COLS} FROM products
    WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as ProductRow | undefined) ?? null;
}
