import { describe, it, expect, beforeEach } from "vitest";
import { createTestIndexer } from "envio";
import { CHAIN, STREAM, SUBSCRIBER, MAX_ESCROW, START_BLOCK, created, deposited } from "./fixtures.js";
import { installFakeIngest, type IngestCall } from "./fake-ingest.js";

let calls: IngestCall[];
beforeEach(() => {
  calls = installFakeIngest();
});

describe("FR-IDX-010/011/014/020 Deposited", () => {
  it("FR_IDX_010_records_the_running_deposit_total", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101, 1_000_000n, 1_000_000n), deposited(102, 500_000n, 1_500_000n)] } } });
    const stream = await indexer.Stream.getOrThrow(STREAM);
    expect(stream.deposited).toBe(1_500_000n);
    expect(stream.status).toBe("Created");
    expect(stream.updatedBlock).toBe(BigInt(START_BLOCK + 102));
  });

  it("FR_IDX_014_writes_one_deposit_ledger_row", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
    const rows = await indexer.LedgerEntry.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "deposit", amount: MAX_ESCROW, from: SUBSCRIBER, to: STREAM, stream_id: STREAM });
    expect(rows[0]!.id).toMatch(new RegExp(`^${CHAIN}_0x[0-9a-f]{64}_0_deposit$`));
  });

  it("FR_IDX_011_writes_a_StreamEvent_marked_sent", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
    const events = await indexer.StreamEvent.getAll();
    const dep = events.find((e) => e.name === "Deposited")!;
    expect(dep).toMatchObject({ stream_id: STREAM, address: STREAM, chainId: CHAIN, ingestStatus: "sent", ingestAttempts: 1, logIndex: 0 });
    expect(dep.blockNumber).toBe(BigInt(START_BLOCK + 101));
  });

  it("FR_IDX_020_022_posts_the_ingest_body_once_with_decimal_strings", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
    const dep = calls.filter((c) => (c.body as { event_name: string }).event_name === "Deposited");
    expect(dep).toHaveLength(1);
    expect(dep[0]!.url).toBe("http://ingest.test/internal/ingest");
    expect(dep[0]!.headers["authorization"] ?? dep[0]!.headers["Authorization"]).toBe("Bearer ingest-test-token");
    expect(dep[0]!.body).toEqual({
      chain_id: CHAIN,
      block_number: START_BLOCK + 101,
      block_hash: expect.stringMatching(/^0xb[0-9a-f]{63}$/),
      block_timestamp: 1_757_000_000 + 101,
      tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      log_index: 0,
      address: STREAM,
      event_name: "Deposited",
      args: { from: SUBSCRIBER, amount: "14400000", totalDeposited: "14400000" },
      ledger: [{ kind: "deposit", amount: "14400000", from: SUBSCRIBER, to: STREAM }],
    });
  });
});
