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

/**
 * Newest first, keyset-paginated on the insertion sequence. Returns `limit + 1` rows so the
 * caller can compute `has_more` (FR-API-080). Throws `invalid` when `startingAfter`
 * is not a product of this merchant and mode, so the cursor cannot probe other data.
 */
export async function listProducts(
  merchantId: string,
  livemode: boolean,
  opts: { limit: number; startingAfter?: string | undefined },
): Promise<ProductRow[]> {
  const scope = sql`merchant_id = ${merchantId} AND livemode = ${livemode}`;
  if (opts.startingAfter) {
    const [cursor] = await sql`SELECT seq FROM products WHERE id = ${opts.startingAfter} AND ${scope}`;
    if (!cursor) throw new CursorNotFound(opts.startingAfter);
    return (await sql`
      SELECT ${COLS} FROM products
      WHERE ${scope} AND seq < ${cursor.seq}
      ORDER BY seq DESC LIMIT ${opts.limit + 1}`) as ProductRow[];
  }
  return (await sql`
    SELECT ${COLS} FROM products WHERE ${scope}
    ORDER BY seq DESC LIMIT ${opts.limit + 1}`) as ProductRow[];
}

export class CursorNotFound extends Error {
  constructor(public readonly id: string) {
    super(`No such product: '${id}'`);
  }
}

/** Partial update of the mutable fields (FR-API-011). Rate is not in the input type on purpose. */
export async function updateProduct(
  merchantId: string,
  livemode: boolean,
  id: string,
  patch: { name?: string | undefined; description?: string | null | undefined; allow_pause?: boolean | undefined; active?: boolean | undefined },
): Promise<ProductRow | null> {
  const [row] = await sql`
    UPDATE products SET
      name = COALESCE(${patch.name ?? null}, name),
      description = CASE WHEN ${"description" in patch} THEN ${patch.description ?? null} ELSE description END,
      allow_pause = COALESCE(${patch.allow_pause ?? null}, allow_pause),
      active = COALESCE(${patch.active ?? null}, active),
      updated_at = clock_timestamp()
    WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}
    RETURNING ${COLS}`;
  return (row as ProductRow | undefined) ?? null;
}
