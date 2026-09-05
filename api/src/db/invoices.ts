import type { SQL } from "bun";
import { sql } from "./client";
import { newId } from "../lib/ids";
import { baseUnitsToDecimal } from "../lib/money";
import { config } from "../config";
import { keysetList } from "../lib/keyset";

/** FR-API-050 storage row. `amount_wei` is gross; `net = gross − fee` on read. */
export interface InvoiceRow {
  id: string;
  merchant_id: string;
  livemode: boolean;
  subscription_id: string;
  customer_id: string;
  period_start: Date;
  period_end: Date;
  seconds: number;
  amount_wei: string;
  fee_wei: string;
  status: "paid" | "failed";
  tx_hash: string;
  log_index: number;
  created_at: Date;
}

const COLS = sql`id, merchant_id, livemode, subscription_id, customer_id, period_start, period_end, seconds,
  amount_wei::text AS amount_wei, fee_wei::text AS fee_wei, status, tx_hash, log_index, created_at`;

export async function insertInvoice(
  input: {
    merchantId: string;
    livemode: boolean;
    subscriptionId: string;
    customerId: string;
    periodStart: number;
    periodEnd: number;
    seconds: number;
    amountWei: bigint;
    feeWei: bigint;
    status: "paid" | "failed";
    txHash: string;
    logIndex: number;
    chainEventId: number | null;
  },
  tx: SQL = sql,
): Promise<InvoiceRow> {
  const [row] = await tx`
    INSERT INTO invoices (id, merchant_id, livemode, subscription_id, customer_id, period_start, period_end, seconds,
                          amount_wei, fee_wei, status, tx_hash, log_index, chain_event_id)
    VALUES (${newId("in")}, ${input.merchantId}, ${input.livemode}, ${input.subscriptionId}, ${input.customerId},
            to_timestamp(${input.periodStart}), to_timestamp(${input.periodEnd}), ${input.seconds},
            ${input.amountWei.toString()}::numeric, ${input.feeWei.toString()}::numeric, ${input.status},
            ${input.txHash}, ${input.logIndex}, ${input.chainEventId})
    RETURNING ${COLS}`;
  return row as InvoiceRow;
}

/** §5.3 Invoice object (dashboard decision 4b: gross, fee, net alongside the frozen `amount_settled`). */
export function serializeInvoice(row: InvoiceRow) {
  const d = config.tokenDecimals;
  const gross = BigInt(row.amount_wei);
  const fee = BigInt(row.fee_wei);
  return {
    id: row.id,
    object: "invoice" as const,
    subscription: row.subscription_id,
    customer: row.customer_id,
    period_start: Math.floor(row.period_start.getTime() / 1000),
    period_end: Math.floor(row.period_end.getTime() / 1000),
    seconds: row.seconds,
    amount_settled: baseUnitsToDecimal(gross, d),
    gross: baseUnitsToDecimal(gross, d),
    fee: baseUnitsToDecimal(fee, d),
    net: baseUnitsToDecimal(gross - fee, d),
    currency: "ausd" as const,
    status: row.status,
    tx_hash: row.tx_hash,
    livemode: row.livemode,
    created: Math.floor(row.created_at.getTime() / 1000),
  };
}

export async function findInvoice(merchantId: string, livemode: boolean, id: string): Promise<InvoiceRow | null> {
  const [row] = await sql`SELECT ${COLS} FROM invoices WHERE id = ${id} AND merchant_id = ${merchantId} AND livemode = ${livemode}`;
  return (row as InvoiceRow) ?? null;
}

/** FR-API-052 list with optional subscription / customer filters, newest first. */
export async function listInvoices(
  merchantId: string,
  livemode: boolean,
  opts: { limit: number; startingAfter?: string | undefined; subscription?: string | undefined; customer?: string | undefined },
): Promise<InvoiceRow[]> {
  const filters = [];
  if (opts.subscription) filters.push(sql`subscription_id = ${opts.subscription}`);
  if (opts.customer) filters.push(sql`customer_id = ${opts.customer}`);
  return keysetList<InvoiceRow>("invoices", COLS, sql`merchant_id = ${merchantId} AND livemode = ${livemode}`, filters, opts);
}
