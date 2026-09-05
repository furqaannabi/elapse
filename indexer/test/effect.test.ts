import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestIndexer } from "envio";
import { CHAIN, STREAM, created, deposited } from "./fixtures.js";
import { installFakeIngest, type IngestCall } from "./fake-ingest.js";
import { _setSleep, RETRY_DELAYS_MS } from "../src/effects.js";

let slept: number[];
beforeEach(() => {
  slept = [];
  _setSleep(async (ms) => {
    slept.push(ms);
  });
});
afterEach(() => {
  _setSleep(undefined);
});

/** Runs create + deposit against a fake ingest and returns the Deposited StreamEvent plus the calls made. */
async function run(responses: Array<number | Error>): Promise<{ calls: IngestCall[]; status: string; attempts: number; error: string | undefined }> {
  const calls = installFakeIngest(responses, "Deposited");
  const indexer = createTestIndexer();
  await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
  const ev = (await indexer.StreamEvent.getAll()).find((e) => e.name === "Deposited")!;
  return { calls: calls.filter((c) => (c.body as { event_name: string }).event_name === "Deposited"), status: ev.ingestStatus, attempts: ev.ingestAttempts, error: ev.ingestError };
}

describe("FR-IDX-021/023/061 postIngest failure modes", () => {
  it("FR_IDX_061_success_is_sent_after_one_attempt", async () => {
    const r = await run([200]);
    expect(r).toMatchObject({ status: "sent", attempts: 1, error: undefined });
    expect(r.calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("FR_IDX_021_a_duplicate_reply_is_recorded_as_duplicate_not_failed", async () => {
    const calls = installFakeIngest([200]);
    const indexer = createTestIndexer();
    // The fake returns {ok:true}; make the second body a duplicate reply by re-installing with a duplicate payload.
    calls.length = 0;
    const dupCalls = installDuplicateIngest();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
    const ev = (await indexer.StreamEvent.getAll()).find((e) => e.name === "Deposited")!;
    expect(ev.ingestStatus).toBe("duplicate");
    expect(dupCalls.length).toBeGreaterThan(0);
  });

  it("FR_IDX_061_5xx_then_success_retries_with_backoff", async () => {
    const r = await run([503, 200]);
    expect(r).toMatchObject({ status: "sent", attempts: 2 });
    expect(r.calls).toHaveLength(2);
    expect(slept).toEqual([RETRY_DELAYS_MS[0]]);
  });

  it("FR_IDX_061_4xx_fails_fast_without_retry", async () => {
    const r = await run([400]);
    expect(r).toMatchObject({ status: "failed", attempts: 1, error: "HTTP 400" });
    expect(r.calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("FR_IDX_061_four_network_errors_give_failed_and_indexing_continues", async () => {
    const r = await run([new Error("ECONNREFUSED")]);
    expect(r).toMatchObject({ status: "failed", attempts: 4, error: "ECONNREFUSED" });
    expect(r.calls).toHaveLength(4);
    expect(slept).toEqual([...RETRY_DELAYS_MS]);
  });

  it("FR_IDX_023_a_failed_ingest_still_updates_the_Stream", async () => {
    installFakeIngest([500]);
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [created(100), deposited(101)] } } });
    const s = await indexer.Stream.getOrThrow(STREAM);
    expect(s.deposited).toBeGreaterThan(0n);
  });
});

function installDuplicateIngest() {
  const calls: unknown[] = [];
  process.env.ENVIO_INGEST_URL = "http://ingest.test/internal/ingest";
  process.env.ENVIO_INGEST_TOKEN = "ingest-test-token";
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    calls.push(init?.body);
    return new Response(JSON.stringify({ duplicate: true }), { status: 200 });
  }) as typeof fetch;
  return calls;
}
