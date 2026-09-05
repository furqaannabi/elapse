/**
 * StreamFactory handlers (indexer FRD FR-IDX-002, FR-IDX-010, FR-IDX-013).
 *
 * `StreamCreated` registers the new AccrualStream clone so every later log on it
 * is indexed, creates the `Stream` entity in `Created` status, and bumps the
 * `Factory` counters. `FeeChanged` records the live fee parameters.
 */
import { indexer, type Stream } from "envio";
import { getOrCreateFactory } from "../lib/factory.js";
import { recordLog } from "../lib/record.js";

indexer.contractRegister(
  { contract: "StreamFactory", event: "StreamCreated" },
  async ({ event, context }) => {
    context.chain.AccrualStream.add(event.params.stream);
  },
);

indexer.onEvent(
  { contract: "StreamFactory", event: "StreamCreated" },
  async ({ event, context }) => {
    const factory = await getOrCreateFactory(context, event.srcAddress, event.chainId);
    const block = BigInt(event.block.number);
    const stream: Stream = {
      id: event.params.stream,
      factory: event.srcAddress,
      merchant: event.params.merchant,
      subscriber: event.params.subscriber,
      token: event.params.token,
      ratePerSecond: event.params.ratePerSecond,
      maxEscrow: event.params.maxEscrow,
      status: "Created",
      pauseReason: undefined,
      startedAt: undefined,
      pausedAt: undefined,
      canceledAt: undefined,
      deposited: 0n,
      settledSeconds: 0n,
      settledAmount: 0n,
      settledFee: 0n,
      refunded: 0n,
      createdBlock: block,
      updatedBlock: block,
    };
    context.Stream.set(stream);
    context.Factory.set({ ...factory, streamCount: factory.streamCount + 1 });
    await recordLog(context, event, "StreamCreated", event.params, stream.id, []);
  },
);

indexer.onEvent({ contract: "StreamFactory", event: "FeeChanged" }, async ({ event, context }) => {
  const factory = await getOrCreateFactory(context, event.srcAddress, event.chainId);
  context.Factory.set({ ...factory, feeBps: Number(event.params.bps), treasury: event.params.treasury });
  await recordLog(context, event, "FeeChanged", event.params, undefined, []);
});
