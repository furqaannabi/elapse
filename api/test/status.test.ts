import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant } from "./helpers";
import { setIndexerReader } from "../src/lib/indexer";
import { deploymentFor } from "../src/chain/deployments";

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
      contracts: { factory: deploymentFor(10143).factory.toLowerCase() },
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

describe("FR-API-075 relayer runway", () => {
  const RELAYER = "0xaf1444abf40afc91bcb4a6793765553c6bccea0d";
  const MON = 1_000_000_000_000_000_000n;
  const now = () => Math.floor(Date.now() / 1000);
  async function seed(points: Array<[ageS: number, mon: number]>) {
    for (const [age, mon] of points) {
      await sql`INSERT INTO relayer_balance_samples (chain_id, address, balance_wei, sampled_at)
                VALUES (10143, ${RELAYER}, ${(BigInt(Math.round(mon * 1000)) * MON / 1000n).toString()}::numeric, to_timestamp(${now() - age}))`;
    }
  }
  const relayer = async () => (await api("GET", "/v1/status")).body.relayer;

  it("FR_API_075_with_no_sample_the_block_is_null_and_stale_and_not_low", async () => {
    expect(await relayer()).toEqual({ address: null, balance_mon: null, sampled_at: null, burn_mon_per_hour: null, hours_left: null, low: false, stale: true });
  });

  // The window is `sampled_at >= now - 3600`, and the request computes its own `now` a moment after
  // `seed` computed this one. A sample planted at exactly 3600 s falls out of the window as soon as
  // that clock ticks, the oldest-in-hour collapses onto the newest, and the burn comes back null —
  // which is how this test failed on three scheduled runs before 2026-09-23 and passed on the rest.
  // Ten seconds inside the boundary is the fix; the arithmetic it asserts is unchanged.
  it("FR_API_075_a_slow_burn_reports_hours_left_and_is_not_low", async () => {
    await seed([[3590, 4.664], [10, 4.64]]);
    const r = await relayer();
    expect(r).toMatchObject({ address: RELAYER, balance_mon: "4.64", low: false, stale: false });
    expect(r.burn_mon_per_hour).toBeCloseTo(0.024, 3);
    expect(r.hours_left).toBeGreaterThan(190);
    expect(r.hours_left).toBeLessThan(200);
  });

  it("FR_API_075_under_24_hours_left_is_low", async () => {
    await seed([[3590, 4.64], [10, 2.0]]);
    const r = await relayer();
    expect(r.hours_left).toBeLessThan(24);
    expect(r.low).toBe(true);
  });

  it("FR_API_075_a_flat_balance_under_the_floor_is_low_with_null_burn", async () => {
    await seed([[3600, 0.5], [10, 0.5]]);
    expect(await relayer()).toMatchObject({ balance_mon: "0.5", burn_mon_per_hour: null, hours_left: null, low: true });
  });

  it("FR_API_075_a_top_up_reads_as_null_burn_and_not_low", async () => {
    await seed([[3600, 2.0], [10, 20.0]]);
    expect(await relayer()).toMatchObject({ balance_mon: "20", burn_mon_per_hour: null, hours_left: null, low: false });
  });

  it("FR_API_075_a_sample_older_than_two_minutes_is_stale_but_still_judged", async () => {
    await seed([[3800, 4.64], [180, 0.4]]);
    expect(await relayer()).toMatchObject({ stale: true, low: true });
  });

  it("FR_API_075_only_the_last_hour_counts_toward_burn", async () => {
    await seed([[7200, 100.0], [3000, 4.664], [10, 4.64]]);
    expect((await relayer()).burn_mon_per_hour).toBeCloseTo(0.024 * 3600 / 2990, 3);
  });
});
