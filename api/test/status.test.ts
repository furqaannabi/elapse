import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant } from "./helpers";
import { setIndexerReader } from "../src/lib/indexer";

beforeEach(async () => {
  await resetDb();
  setIndexerReader(async () => ({ latest_block: 60_010_000, head_block: 60_010_004, updated_at: Math.floor(Date.now() / 1000) - 1, unsent_events: 0 }));
});
afterEach(() => setIndexerReader(null));

describe("FR-API-074 status", () => {
  it("FR_API_074_is_public_and_reports_chain_indexer_and_worker", async () => {
    const r = await api("GET", "/v1/status");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      chain_id: 10143,
      contracts: { factory: "0x656fa8b348981602acf36fad07804e806cc15d5b" },
      indexer: { latest_block: 60_010_000, head_block: 60_010_004, lag_blocks: 4, unsent_events: 0, ok: true },
      worker: { queued: 0, oldest_queued_age_s: 0 },
    });
    expect(r.body.indexer.lag_seconds).toBeGreaterThanOrEqual(0);
    expect(r.body.indexer.last_ingest_at).toBeNull();
    expect(r.body.block_time_ms).toBe(400);
  });

  it("FR_API_074_reports_queue_depth_and_last_ingest", async () => {
    const m = await seedMerchant();
    await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://merchant.example/hooks", events: ["*"] } });
    await api("POST", "/v1/webhook_endpoints/" + (await api("GET", "/v1/webhook_endpoints", { key: m.skTest })).body.data[0].id + "/test", { key: m.skTest, body: { type: "subscription.created" } });
    await sql`UPDATE deliveries SET created_at = now() - interval '42 seconds'`;
    await sql`INSERT INTO chain_events (chain_id, block_number, block_hash, block_timestamp, tx_hash, log_index, address, event_name, args)
              VALUES (10143, 1, '0xb', 1, '0xt', 0, '0xa', 'Deposited', '{}'::jsonb)`;
    const r = await api("GET", "/v1/status");
    expect(r.body.worker.queued).toBe(1);
    expect(r.body.worker.oldest_queued_age_s).toBeGreaterThanOrEqual(41);
    expect(r.body.indexer.last_ingest_at).toBeGreaterThan(0);
  });

  it("FR_API_074_an_unreachable_indexer_is_reported_not_thrown", async () => {
    setIndexerReader(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await api("GET", "/v1/status");
    expect(r.status).toBe(200);
    expect(r.body.indexer).toMatchObject({ ok: false, error: "unreachable" });
  });
});
