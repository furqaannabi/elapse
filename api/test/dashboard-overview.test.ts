import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { createSession } from "../src/db/sessions";

let m: Fixture;
let cookie: string;
const H = () => ({ cookie, origin: "http://localhost:3000", "x-elapse-mode": "test" });

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  cookie = `elapse_session=${(await createSession(m.merchantId, null)).token}`;
});

async function fixture() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  await sql`INSERT INTO customers (id, merchant_id, livemode, wallet_address, email) VALUES ('cus_a', ${m.merchantId}, false, '0x0000000000000000000000000000000000000001', 'a@x.test')`;
  const now = Math.floor(Date.now() / 1000);
  const mk = (id: string, status: string, startedAgo: number | null, settledWei = 0) =>
    sql`INSERT INTO subscriptions (id, merchant_id, livemode, product_id, customer_id, status, chain_id, rate_per_second_wei, max_duration_seconds, max_escrow_wei, funded_wei, settled_wei, started_at, stream_address)
        VALUES (${id}, ${m.merchantId}, false, ${p.body.id}, 'cus_a', ${status}, 10143, 4000, 3600, 14400000, 14400000, ${settledWei},
                ${startedAgo === null ? null : new Date((now - startedAgo) * 1000)}, ${"0x" + id.padEnd(40, "0").slice(0, 40)})`;
  await mk("sub_run1", "active", 600); // 10 min ago → ~2.4 USD accrued today (if today)
  await mk("sub_run2", "active", 60);
  await mk("sub_paused", "paused", 3000);
  await mk("sub_done", "canceled", 7200, 880000);
  await sql`INSERT INTO invoices (id, merchant_id, livemode, subscription_id, customer_id, period_start, period_end, seconds, amount_wei, fee_wei, status, tx_hash, log_index)
            VALUES ('in_1', ${m.merchantId}, false, 'sub_done', 'cus_a', now() - interval '1 hour', now(), 220, 880000, 8800, 'paid', '0x1', 0),
                   ('in_2', ${m.merchantId}, false, 'sub_done', 'cus_a', now() - interval '10 days', now() - interval '10 days', 100, 400000, 4000, 'paid', '0x2', 0),
                   ('in_3', ${m.merchantId}, false, 'sub_done', 'cus_a', now(), now(), 0, 0, 0, 'failed', '0x3', 1)`;
  return p.body.id as string;
}

describe("FR-DSH-021..023 overview", () => {
  it("returns the four tiles, the running list with product and customer, and recent events", async () => {
    await fixture();
    const r = await api("GET", "/v1/dashboard/overview", { headers: H() });
    expect(r.status).toBe(200);
    expect(r.body.running_now).toBe(2);
    expect(r.body.settled_week_net_usd).toBe("0.8712"); // 880000 − 8800 fee, this week only
    expect(r.body.failed_payments_week).toBe(1);
    const accrued = Number(r.body.accrued_today_usd);
    expect(accrued).toBeGreaterThan(2.5); // 600 s + 60 s at 0.004, minus nothing
    expect(accrued).toBeLessThan(2.8);
    expect(r.body.running.map((s: any) => s.id).sort()).toEqual(["sub_run1", "sub_run2"]);
    expect(r.body.running[0]).toMatchObject({ product_name: "GPU", customer_email: "a@x.test", object: "subscription" });
    expect(Array.isArray(r.body.recent_events)).toBe(true);
    expect((await api("GET", "/v1/dashboard/overview", { key: m.skTest })).status).toBe(401); // cookie only
  });

  it("subscriptions carry product_name and customer_email on every read", async () => {
    await fixture();
    const one = await api("GET", "/v1/subscriptions/sub_paused", { key: m.skTest });
    expect(one.body).toMatchObject({ product_name: "GPU", customer_email: "a@x.test" });
    const list = await api("GET", "/v1/subscriptions?status=canceled", { key: m.skTest });
    expect(list.body.data[0]).toMatchObject({ id: "sub_done", product_name: "GPU" });
  });
});
