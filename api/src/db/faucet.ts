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

type Scope = { wallet: string } | { ip: string } | "all";

export async function dropWindow(scope: Scope): Promise<DropWindow> {
  const where =
    scope === "all"
      ? sql`TRUE`
      : "wallet" in scope
        ? sql`wallet_address = ${scope.wallet.toLowerCase()}`
        : sql`ip = ${scope.ip}`;
  const [row] = await sql`
    SELECT count(*)::int AS count, min(created_at) AS oldest
    FROM faucet_drops
    WHERE ${where} AND created_at > now() - interval '24 hours'`;
  return { count: row.count, oldest: row.oldest ?? null };
}

export async function recordDrop(drop: { wallet: string; ip: string | null; units: bigint; txHash: string }): Promise<void> {
  await sql`
    INSERT INTO faucet_drops (wallet_address, ip, amount_units, tx_hash)
    VALUES (${drop.wallet.toLowerCase()}, ${drop.ip}, ${drop.units.toString()}, ${drop.txHash})`;
}
