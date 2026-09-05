/**
 * AccrualStream handlers (indexer FRD FR-IDX-003, FR-IDX-010..014).
 *
 * Each handler is a pure function of the log and the current `Stream` (FR-IDX-031): it
 * computes the next `Stream` state, describes the money that moved, and hands both to
 * `recordLog`, which owns the `StreamEvent`, `LedgerEntry` and ingest side effect.
 * Zero-amount fee and refund rows are not written: a ledger line that moves nothing is noise
 * in the dashboard's Balance & payouts view (FR-DSH-122).
 */
import { indexer, type Stream } from "envio";
import { recordLog, type LedgerRow } from "../lib/record.js";
import { getOrCreateFactory } from "../lib/factory.js";

indexer.onEvent({ contract: "AccrualStream", event: "Deposited" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  context.Stream.set({ ...stream, deposited: event.params.totalDeposited, updatedBlock: BigInt(event.block.number) });
  await recordLog(context, event, "Deposited", event.params, stream.id, [
    { kind: "deposit", amount: event.params.amount.toString(), from: event.params.from, to: stream.id },
  ]);
});

indexer.onEvent({ contract: "AccrualStream", event: "StreamStarted" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  const factory = await getOrCreateFactory(context, stream.factory, event.chainId);
  context.Stream.set({ ...stream, status: "Active", startedAt: event.params.startedAt, updatedBlock: BigInt(event.block.number) });
  context.Factory.set({ ...factory, activeCount: factory.activeCount + 1 });
  await recordLog(context, event, "StreamStarted", event.params, stream.id, []);
});

indexer.onEvent({ contract: "AccrualStream", event: "StreamPaused" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  const factory = await getOrCreateFactory(context, stream.factory, event.chainId);
  context.Stream.set({
    ...stream,
    status: "Paused",
    pausedAt: event.params.at,
    pauseReason: Number(event.params.reason),
    updatedBlock: BigInt(event.block.number),
  });
  context.Factory.set({ ...factory, activeCount: factory.activeCount - 1 });
  await recordLog(context, event, "StreamPaused", event.params, stream.id, []);
});

indexer.onEvent({ contract: "AccrualStream", event: "StreamResumed" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  const factory = await getOrCreateFactory(context, stream.factory, event.chainId);
  context.Stream.set({ ...stream, status: "Active", pausedAt: undefined, pauseReason: undefined, updatedBlock: BigInt(event.block.number) });
  context.Factory.set({ ...factory, activeCount: factory.activeCount + 1 });
  await recordLog(context, event, "StreamResumed", event.params, stream.id, []);
});

indexer.onEvent({ contract: "AccrualStream", event: "Settled" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  const factory = await getOrCreateFactory(context, stream.factory, event.chainId);
  const { seconds_: seconds, amount, fee } = event.params;
  const block = BigInt(event.block.number);

  context.Stream.set({
    ...stream,
    settledSeconds: stream.settledSeconds + seconds,
    settledAmount: stream.settledAmount + amount,
    settledFee: stream.settledFee + fee,
    updatedBlock: block,
  });
  context.Factory.set({ ...factory, totalSettled: factory.totalSettled + amount, totalFees: factory.totalFees + fee });
  context.Settlement.set({
    id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
    stream_id: stream.id,
    seconds,
    amount,
    fee,
    blockNumber: block,
    blockTimestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  const ledger: LedgerRow[] = [{ kind: "settlement", amount: (amount - fee).toString(), from: stream.id, to: stream.merchant }];
  if (fee > 0n) ledger.push({ kind: "fee", amount: fee.toString(), from: stream.id, to: factory.treasury });
  await recordLog(context, event, "Settled", event.params, stream.id, ledger);
});

indexer.onEvent({ contract: "AccrualStream", event: "StreamCanceled" }, async ({ event, context }) => {
  const stream = await context.Stream.getOrThrow(event.srcAddress);
  const factory = await getOrCreateFactory(context, stream.factory, event.chainId);
  const wasActive = stream.status === "Active";
  const next: Stream = {
    ...stream,
    status: "Canceled",
    canceledAt: event.params.at,
    pausedAt: undefined,
    pauseReason: undefined,
    refunded: event.params.amountRefunded,
    updatedBlock: BigInt(event.block.number),
  };
  context.Stream.set(next);
  if (wasActive) context.Factory.set({ ...factory, activeCount: factory.activeCount - 1 });

  const ledger: LedgerRow[] = [];
  if (event.params.amountRefunded > 0n) {
    ledger.push({ kind: "refund", amount: event.params.amountRefunded.toString(), from: stream.id, to: stream.subscriber });
  }
  await recordLog(context, event, "StreamCanceled", event.params, stream.id, ledger);
});
