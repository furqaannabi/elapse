import type { SQL } from "bun";
import { sql } from "./client";
import { newId } from "../lib/ids";

/** FR-API-020. One Customer per (Merchant, mode, wallet). Addresses are stored lowercase. */
export interface CustomerRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  email: string | null;
  passkey_id: string | null;
  wallet_address: string;
  created_at: Date;
}

const COLS = sql`id, merchant_id, livemode, email, passkey_id, wallet_address, created_at`;

/** Insert or return the existing Customer for this wallet (FR-API-020 "second session reuses cus_"). */
export async function insertCustomer(
  input: { merchantId: string; livemode: boolean; walletAddress: string; email?: string | null; passkeyId?: string | null },
  tx: SQL = sql,
): Promise<CustomerRow> {
  const wallet = input.walletAddress.toLowerCase();
  const [existing] = await tx`SELECT ${COLS} FROM customers WHERE merchant_id = ${input.merchantId} AND livemode = ${input.livemode} AND wallet_address = ${wallet}`;
  if (existing) return existing as CustomerRow;
  const [row] = await tx`
    INSERT INTO customers (id, merchant_id, livemode, email, passkey_id, wallet_address)
    VALUES (${newId("cus")}, ${input.merchantId}, ${input.livemode}, ${input.email ?? null}, ${input.passkeyId ?? null}, ${wallet})
    RETURNING ${COLS}`;
  return row as CustomerRow;
}

export async function findCustomer(merchantId: string, livemode: boolean, id: string): Promise<CustomerRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM customers WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as CustomerRow) ?? null;
}

/** §3 Customer object. */
export function serializeCustomer(row: CustomerRow) {
  return {
    id: row.id,
    object: "customer" as const,
    email: row.email,
    wallet_address: row.wallet_address,
    default_payment: "ausd" as const,
    livemode: row.livemode,
    created: Math.floor(row.created_at.getTime() / 1000),
  };
}
