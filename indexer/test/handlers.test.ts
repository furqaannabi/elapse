import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestIndexer } from "envio";
import { CHAIN, FACTORY, STREAM, MERCHANT, SUBSCRIBER, TOKEN, RATE, MAX_ESCROW, START_BLOCK, created } from "./fixtures.js";
import { installFakeIngest } from "./fake-ingest.js";

beforeEach(() => {
  installFakeIngest();
});

describe("FR-IDX-002 / FR-IDX-010 StreamCreated", () => {
  it("FR_IDX_002_registers_the_clone_for_indexing", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created()] } } });
    expect(indexer.chains[CHAIN].AccrualStream.addresses).toContain(STREAM);
  });

  it("FR_IDX_010_creates_the_Stream_in_Created_status", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100)] } } });
    const stream = await indexer.Stream.getOrThrow(STREAM);
    expect(stream).toMatchObject({
      id: STREAM,
      factory: FACTORY,
      merchant: MERCHANT,
      subscriber: SUBSCRIBER,
      token: TOKEN,
      ratePerSecond: RATE,
      maxEscrow: MAX_ESCROW,
      status: "Created",
      deposited: 0n,
      settledSeconds: 0n,
      settledAmount: 0n,
      settledFee: 0n,
      refunded: 0n,
      createdBlock: BigInt(START_BLOCK + 100),
      updatedBlock: BigInt(START_BLOCK + 100),
    });
  });

  it("FR_IDX_013_bumps_the_Factory_stream_count", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), { ...created(101), params: { ...created().params, stream: "0x3333333333333333333333333333333333333333" } }] } } });
    const factory = await indexer.Factory.getOrThrow(FACTORY);
    expect(factory.streamCount).toBe(2);
    expect(factory.activeCount).toBe(0);
  });
});
