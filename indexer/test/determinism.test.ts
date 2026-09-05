import { describe, it, expect, beforeEach } from "vitest";
import { createTestIndexer } from "envio";
import { CHAIN, KILL_GATE } from "./fixtures.js";
import { installFakeIngest } from "./fake-ingest.js";

beforeEach(() => {
  installFakeIngest();
});

/** Strips the wall-clock field the recorder stamps after the ingest call. */
const stable = <T extends { lastIngestAt?: bigint | undefined }>(rows: T[]) =>
  rows.map(({ lastIngestAt: _l, ...r }) => r).sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1));

describe("FR-IDX-031 determinism", () => {
  it("FR_IDX_031_replaying_the_same_logs_yields_identical_entities", async () => {
    const seq = KILL_GATE.sequence();
    const a = createTestIndexer();
    await a.process({ chains: { [CHAIN]: { simulate: seq } } });
    const b = createTestIndexer();
    await b.process({ chains: { [CHAIN]: { simulate: seq } } });

    expect(await a.Stream.getAll()).toEqual(await b.Stream.getAll());
    expect(await a.Factory.getAll()).toEqual(await b.Factory.getAll());
    expect(await a.Settlement.getAll()).toEqual(await b.Settlement.getAll());
    expect(stable(await a.LedgerEntry.getAll())).toEqual(stable(await b.LedgerEntry.getAll()));
    expect(stable(await a.StreamEvent.getAll())).toEqual(stable(await b.StreamEvent.getAll()));
  });
});
