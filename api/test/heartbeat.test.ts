import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb } from "./helpers";
import { beat, workerHealth, HEARTBEAT_STALE_S } from "../src/worker/heartbeat";
import { setIndexerReader } from "../src/lib/indexer";

beforeEach(async () => {
  await resetDb();
  await sql`TRUNCATE worker_heartbeat`;
  setIndexerReader(async () => ({ latest_block: 1, head_block: 1, updated_at: 0, unsent_events: 0 }));
});
afterEach(() => setIndexerReader(null));

describe("FR-WRK-060 heartbeat", () => {
  it("FR_WRK_060_status_says_no_worker_until_one_has_beaten", async () => {
    const r = await api("GET", "/v1/status");
    expect(r.body.worker).toMatchObject({ alive: false, last_seen_at: null, queued: 0 });
  });

  it("FR_WRK_060_a_fresh_beat_is_alive_and_carries_the_counters", async () => {
    await beat("w1", { now: new Date(), keeperTickAt: new Date() });
    const h = await workerHealth(new Date());
    expect(h).toMatchObject({ alive: true, worker_id: "w1", attempts_last_minute: 0, success_rate_1h: null });
    const r = await api("GET", "/v1/status");
    expect(r.body.worker.alive).toBe(true);
    expect(r.body.worker.last_seen_at).toBeGreaterThan(0);
  });

  it("FR_WRK_060_a_beat_older_than_15_s_reads_as_stalled", async () => {
    const then = new Date(Date.now() - (HEARTBEAT_STALE_S + 1) * 1000);
    await beat("w1", { now: then });
    const h = await workerHealth(new Date());
    expect(h.alive).toBe(false);
    expect(h.last_seen_at).not.toBeNull();
  });

  it("FR_WRK_060_counters_come_from_delivery_attempts", async () => {
    await sql`INSERT INTO merchants (id, name, email) VALUES ('mrc_h', 'H', 'h@example.com')`;
    await sql`INSERT INTO webhook_endpoints (id, merchant_id, livemode, url, events, secret_enc) VALUES ('wh_h', 'mrc_h', false, 'https://h.example/x', '{*}', '\\x00')`;
    await sql`INSERT INTO events (id, merchant_id, livemode, type, data, raw_body) VALUES ('evt_h', 'mrc_h', false, 'subscription.created', '{}'::jsonb, '{}')`;
    await sql`INSERT INTO deliveries (id, event_id, endpoint_id, status) VALUES ('dlv_h', 'evt_h', 'wh_h', 'succeeded')`;
    await sql`INSERT INTO delivery_attempts (id, delivery_id, n, sent_at, duration_ms, status_code) VALUES
      ('att_1', 'dlv_h', 1, now() - interval '20 seconds', 10, 200),
      ('att_2', 'dlv_h', 2, now() - interval '30 minutes', 10, 500),
      ('att_3', 'dlv_h', 3, now() - interval '2 hours', 10, 200)`;
    await beat("w1", { now: new Date() });
    const h = await workerHealth(new Date());
    expect(h.attempts_last_minute).toBe(1);
    expect(h.success_rate_1h).toBe(0.5);
  });
});
