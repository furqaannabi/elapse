/**
 * Shared per-log bookkeeping for every AccrualStream handler (FR-IDX-011, FR-IDX-014, FR-IDX-020..022).
 *
 * `recordLog` writes the `StreamEvent` row, the derived `LedgerEntry` rows, posts the ingest
 * body through the `postIngest` Effect, and stamps the resulting ingest status on the event row.
 * Handlers stay pure: they compute the new `Stream` state and describe money movement; this
 * module owns the side effect.
 */
import type { EvmOnEventContext, LedgerEntry, StreamEvent } from "envio";
import { postIngest, type IngestBody } from "../effects.js";

export type LedgerRow = IngestBody["ledger"][number];

/** The subset of an event every handler can hand over without knowing its params type. */
export type LogRef = {
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: { number: number; timestamp: number; hash: string };
  transaction: { hash: string };
};

/** `uint256` → decimal string, addresses stay lowercase strings (FR-IDX-022, BR-IDX-005). */
export function serializeArgs(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k.replace(/_$/, "")] = typeof v === "bigint" ? v.toString() : String(v);
  }
  return out;
}

export function logId(event: LogRef): string {
  return `${event.chainId}_${event.transaction.hash}_${event.logIndex}`;
}

export async function recordLog(
  context: EvmOnEventContext,
  event: LogRef,
  name: string,
  params: Record<string, unknown>,
  streamId: string | undefined,
  ledger: LedgerRow[],
): Promise<void> {
  const id = logId(event);
  const base = {
    blockNumber: BigInt(event.block.number),
    blockHash: event.block.hash,
    blockTimestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
  };

  if (streamId) {
    for (const row of ledger) {
      const entry: LedgerEntry = {
        id: `${id}_${row.kind}`,
        stream_id: streamId,
        kind: row.kind,
        amount: BigInt(row.amount),
        from: row.from,
        to: row.to,
        ...base,
      };
      context.LedgerEntry.set(entry);
    }
  }

  const args = serializeArgs(params);
  const result = await context.effect(postIngest, {
    chain_id: event.chainId,
    block_number: event.block.number,
    block_hash: event.block.hash,
    block_timestamp: event.block.timestamp,
    tx_hash: event.transaction.hash,
    log_index: event.logIndex,
    address: event.srcAddress,
    event_name: name,
    args,
    ledger,
  });

  const row: StreamEvent = {
    id,
    chainId: event.chainId,
    stream_id: streamId,
    address: event.srcAddress,
    name,
    args,
    ingestStatus: result.status,
    ingestAttempts: result.attempts,
    lastIngestAt: BigInt(Math.floor(Date.now() / 1000)),
    ingestError: result.error,
    ...base,
  };
  context.StreamEvent.set(row);
}
