import { sql } from "./client";

/**
 * FR-API-148: the record of faucet drops, and the rolling 24-hour counts the limits read. Only
 * drops actually sent are recorded. Wallets are stored lowercase.
 */
export interface DropWindow {
  count: number;
  /** The oldest drop still inside the window; the limit eases a day after it. */
  oldest: Date | null;
}

/** `merchant` counts only the drops that merchant asked for on the dashboard (FR-API-151). */
type Scope = { wallet: string } | { ip: string } | { merchant: string } | "all";

export async function dropWindow(scope: Scope): Promise<DropWindow> {
  const where =
    scope === "all"
      ? sql`TRUE`
      : "wallet" in scope
        ? sql`wallet_address = ${scope.wallet.toLowerCase()}`
        : "ip" in scope
          ? sql`ip = ${scope.ip}`
          : sql`merchant_id = ${scope.merchant} AND via = 'dashboard'`;
  const [row] = await sql`
    SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM faucet_drops
    WHERE ${where} AND created_at > now() - interval '24 hours'`;
  return { count: row.count, oldest: row.oldest ?? null };
}

export async function recordDrop(drop: { wallet: string; ip: string | null; units: bigint; txHash: string; merchantId: string; via: "checkout" | "dashboard" }): Promise<void> {
  await sql`
    INSERT INTO faucet_drops (wallet_address, ip, amount_units, tx_hash, merchant_id, via)
    VALUES (${drop.wallet.toLowerCase()}, ${drop.ip}, ${drop.units.toString()}, ${drop.txHash}, ${drop.merchantId}, ${drop.via})`;
}
