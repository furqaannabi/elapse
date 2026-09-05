import { describe, it, expect, beforeEach } from "vitest";
import { createTestIndexer } from "envio";
import {
  CHAIN, FACTORY, STREAM, MERCHANT, SUBSCRIBER, TREASURY, MAX_ESCROW, START_BLOCK, T0,
  created, deposited, started, paused, resumed, settled, canceled, feeChanged, KILL_GATE,
} from "./fixtures.js";
import { installFakeIngest, type IngestCall } from "./fake-ingest.js";

let calls: IngestCall[];
beforeEach(() => {
  calls = installFakeIngest();
});

describe("FR-IDX-010 stream lifecycle", () => {
  it("FR_IDX_010_StreamStarted_activates_the_stream", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101), started(102, T0)] } } });
    const s = await indexer.Stream.getOrThrow(STREAM);
    expect(s).toMatchObject({ status: "Active", startedAt: BigInt(T0), pausedAt: undefined });
    const f = await indexer.Factory.getOrThrow(FACTORY);
    expect(f.activeCount).toBe(1);
  });

  it("FR_IDX_010_pause_and_resume_track_status_and_pausedAt", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101), started(102, T0), paused(110, T0 + 30)] } } });
    let s = await indexer.Stream.getOrThrow(STREAM);
    expect(s).toMatchObject({ status: "Paused", pausedAt: BigInt(T0 + 30), pauseReason: 0 });
    expect((await indexer.Factory.getOrThrow(FACTORY)).activeCount).toBe(0);

    await indexer.process({ chains: { [CHAIN]: { simulate: [resumed(120, T0 + 90)] } } });
    s = await indexer.Stream.getOrThrow(STREAM);
    expect(s).toMatchObject({ status: "Active", pausedAt: undefined, pauseReason: undefined });
    expect((await indexer.Factory.getOrThrow(FACTORY)).activeCount).toBe(1);
  });

  it("FR_IDX_012_Settled_accumulates_and_writes_a_Settlement_and_two_ledger_rows", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [feeChanged(99, 100), created(100), deposited(101), started(102, T0), settled(130, 60n, 240_000n, 2_400n), settled(140, 30n, 120_000n, 1_200n)] } } });
    const s = await indexer.Stream.getOrThrow(STREAM);
    expect(s).toMatchObject({ status: "Active", settledSeconds: 90n, settledAmount: 360_000n, settledFee: 3_600n });
    const settlements = await indexer.Settlement.getAll();
    expect(settlements).toHaveLength(2);
    expect(settlements[0]).toMatchObject({ stream_id: STREAM, seconds: 60n, amount: 240_000n, fee: 2_400n, blockNumber: BigInt(START_BLOCK + 130) });
    const ledger = (await indexer.LedgerEntry.getAll()).filter((r) => r.kind !== "deposit");
    expect(ledger.map((r) => [r.kind, r.amount, r.to]).sort()).toEqual(
      [["settlement", 237_600n, MERCHANT], ["fee", 2_400n, TREASURY], ["settlement", 118_800n, MERCHANT], ["fee", 1_200n, TREASURY]].sort(),
    );
    const f = await indexer.Factory.getOrThrow(FACTORY);
    expect(f).toMatchObject({ totalSettled: 360_000n, totalFees: 3_600n });
  });

  it("FR_IDX_014_Settled_with_zero_fee_writes_no_fee_row", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [feeChanged(99, 0), created(100), deposited(101), started(102, T0), settled(130, 10n, 40_000n, 0n)] } } });
    const ledger = await indexer.LedgerEntry.getAll();
    expect(ledger.map((r) => r.kind).sort()).toEqual(["deposit", "settlement"]);
    expect(ledger.find((r) => r.kind === "settlement")!.amount).toBe(40_000n);
  });

  it("FR_IDX_010_014_kill_gate_cancel_leaves_a_Canceled_stream_and_four_ledger_rows", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: KILL_GATE.sequence() } } });
    const s = await indexer.Stream.getOrThrow(STREAM);
    expect(s).toMatchObject({
      status: "Canceled",
      canceledAt: BigInt(T0 + 220),
      settledSeconds: 220n,
      settledAmount: KILL_GATE.gross,
      settledFee: KILL_GATE.fee,
      refunded: KILL_GATE.refund,
      deposited: MAX_ESCROW,
    });
    const ledger = await indexer.LedgerEntry.getAll();
    expect(ledger.map((r) => r.kind).sort()).toEqual(["deposit", "fee", "refund", "settlement"]);
    const inflow = ledger.filter((r) => r.to === STREAM).reduce((a, r) => a + r.amount, 0n);
    const outflow = ledger.filter((r) => r.from === STREAM).reduce((a, r) => a + r.amount, 0n);
    expect(inflow - outflow).toBe(0n);
    expect(ledger.find((r) => r.kind === "refund")).toMatchObject({ amount: KILL_GATE.refund, from: STREAM, to: SUBSCRIBER });
    const f = await indexer.Factory.getOrThrow(FACTORY);
    expect(f).toMatchObject({ streamCount: 1, activeCount: 0, totalSettled: KILL_GATE.gross, totalFees: KILL_GATE.fee });
  });

  it("FR_IDX_011_every_log_has_a_StreamEvent_and_one_ingest_call", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: KILL_GATE.sequence() } } });
    const events = await indexer.StreamEvent.getAll();
    expect(events.map((e) => e.name).sort()).toEqual(["Deposited", "FeeChanged", "Settled", "StreamCanceled", "StreamCreated", "StreamStarted"]);
    expect(events.every((e) => e.ingestStatus === "sent")).toBe(true);
    expect(calls.map((c) => (c.body as { event_name: string }).event_name).sort()).toEqual(events.map((e) => e.name).sort());
    const cancel = calls.find((c) => (c.body as { event_name: string }).event_name === "StreamCanceled")!.body as { args: Record<string, string>; ledger: unknown[]; log_index: number };
    expect(cancel.args).toEqual({ at: String(T0 + 220), secondsElapsed: "220", amountSettled: "880000", amountRefunded: "13520000" });
    expect(cancel.ledger).toEqual([{ kind: "refund", amount: "13520000", from: STREAM, to: SUBSCRIBER }]);
    expect(cancel.log_index).toBe(1);
  });

  it("FR_IDX_013_FeeChanged_updates_the_Factory_fee_parameters", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [feeChanged(99, 250, "0x9999999999999999999999999999999999999999")] } } });
    const f = await indexer.Factory.getOrThrow(FACTORY);
    expect(f).toMatchObject({ feeBps: 250, treasury: "0x9999999999999999999999999999999999999999", streamCount: 0 });
  });
});
