import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { createSession } from "../src/db/sessions";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";

let m: Fixture;
let cookie: string;
const H = (mode: "test" | "live" = "test") => ({ cookie, origin: "http://localhost:3000", "x-elapse-mode": mode });
const dash = (method: string, path: string, body?: unknown, mode: "test" | "live" = "test") => api(method, path, { body, headers: H(mode) });

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  cookie = `elapse_session=${(await createSession(m.merchantId, null)).token}`;
  setChainClient(fakeChain({ balances: { "0x1111111111111111111111111111111111111111": 1_234_560n } }).client);
});
afterEach(() => setChainClient(null));

async function ledgerFixture() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  await sql`INSERT INTO customers (id, merchant_id, livemode, wallet_address, email) VALUES ('cus_1', ${m.merchantId}, false, '0x0000000000000000000000000000000000000001', 'ann@x.test')`;
  await sql`INSERT INTO subscriptions (id, merchant_id, livemode, product_id, customer_id, status, chain_id, rate_per_second_wei, max_duration_seconds, max_escrow_wei)
            VALUES ('sub_1', ${m.merchantId}, false, ${p.body.id}, 'cus_1', 'canceled', 10143, 4000, 3600, 14400000)`;
  const row = (id: string, kind: string, amt: number, ts: number) =>
    sql`INSERT INTO ledger_entries (id, merchant_id, livemode, kind, amount_wei, from_address, to_address, subscription_id, customer_id, chain_id, tx_hash, log_index, block_hash, block_timestamp)
        VALUES (${id}, ${m.merchantId}, false, ${kind}, ${amt}, '0xa', '0xb', 'sub_1', 'cus_1', 10143, ${"0x" + id}, ${kind.length}, '0xh', ${ts})`;
  const now = Math.floor(Date.now() / 1000);
  await row("led_1", "deposit", 14_400_000, now - 300);
  await row("led_2", "settlement", 871_200, now - 100);
  await row("led_3", "fee", 8_800, now - 100);
  await row("led_4", "refund", 13_520_000, now - 100);
  await sql`INSERT INTO invoices (id, merchant_id, livemode, subscription_id, customer_id, period_start, period_end, seconds, amount_wei, fee_wei, status, tx_hash, log_index)
            VALUES ('in_1', ${m.merchantId}, false, 'sub_1', 'cus_1', now() - interval '1 hour', now(), 220, 880000, 8800, 'paid', '0x1', 0)`;
  return now;
}

describe("FR-API-107 ledger", () => {
  it("lists the four kinds newest first with a summary, filters by kind and subscription, and exports CSV", async () => {
    await ledgerFixture();
    const r = await dash("GET", "/v1/dashboard/ledger");
    expect(r.status).toBe(200);
    expect(r.body.data.map((e: any) => e.kind)).toEqual(["refund", "fee", "settlement", "deposit"]);
    expect(r.body.data[0]).toMatchObject({ id: "led_4", amount_usd: "13.52", subscription: "sub_1", customer: "cus_1", customer_email: "ann@x.test", tx_hash: "0xled_4", reversed_by: null });
    expect(r.body.summary).toEqual({ deposit: "14.4", settlement: "0.8712", fee: "0.0088", refund: "13.52" });
    expect((await dash("GET", "/v1/dashboard/ledger?kind=fee")).body.data).toHaveLength(1);
    expect((await dash("GET", "/v1/dashboard/ledger?subscription=sub_nope")).body.data).toHaveLength(0);
  });

  it("CSV has the same rows and columns", async () => {
    await ledgerFixture();
    const { app } = await import("../src/app");
    const res = await app.request("/v1/dashboard/ledger?format=csv", { headers: H() });
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("id,kind,amount_usd,subscription,customer,customer_email,tx_hash,log_index,block_timestamp,reversed_by");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain("led_4,refund,13.52,sub_1,cus_1,ann@x.test,0xled_4");
  });
});

describe("FR-API-108 balance and FR-API-106 payout address", () => {
  it("reads the token balance at the payout address and this month's net", async () => {
    await ledgerFixture();
    const r = await dash("GET", "/v1/dashboard/balance");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ payout_address: "0x1111111111111111111111111111111111111111", balance_usd: "1.23456", settled_this_month_net_usd: "0.8712" });
    expect(r.body.explorer_url).toContain("0x1111111111111111111111111111111111111111");
  });

  it("404 no_payout_address when unset; change requires a re-typed match and writes an audit row", async () => {
    await sql`UPDATE merchants SET payout_address = NULL WHERE id = ${m.merchantId}`;
    const r = await dash("GET", "/v1/dashboard/balance");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("no_payout_address");
    const bad = await dash("POST", "/v1/dashboard/payout_address", { address: "0xAbC0000000000000000000000000000000000001", confirm: "0xabc0000000000000000000000000000000000002" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.param).toBe("confirm");
    const ok = await dash("POST", "/v1/dashboard/payout_address", { address: "0xAbC0000000000000000000000000000000000001", confirm: "0xAbC0000000000000000000000000000000000001" });
    expect(ok.status).toBe(200);
    expect(ok.body.payout_address).toBe("0xabc0000000000000000000000000000000000001");
    const [row] = await sql`SELECT action, target FROM audit_log WHERE merchant_id = ${m.merchantId} AND action = 'payout_address_changed'`;
    expect(row.target).toBe("0xabc0000000000000000000000000000000000001");
  });
});

describe("FR-API-109 notifications, FR-API-110 activity, FR-API-111 delete test data", () => {
  it("lists notifications for the mode with unread counts and marks one mode read", async () => {
    await sql`INSERT INTO notifications (id, merchant_id, livemode, kind, summary, target_id) VALUES
      ('ntf_1', ${m.merchantId}, false, 'payment_failed', 'Sub ran out', 'sub_1'),
      ('ntf_2', ${m.merchantId}, false, 'endpoint_exhausted', 'Endpoint disabled', 'wh_1'),
      ('ntf_3', ${m.merchantId}, true, 'key_expiring', 'Key expiring', 'key_1')`;
    const r = await dash("GET", "/v1/dashboard/notifications");
    expect(r.body.data.map((n: any) => n.id)).toEqual(["ntf_2", "ntf_1"]);
    expect(r.body).toMatchObject({ unread: 2, other_mode_unread: 1 });
    await dash("POST", "/v1/dashboard/notifications/read_all");
    const after = await dash("GET", "/v1/dashboard/notifications");
    expect(after.body.unread).toBe(0);
    expect(after.body.other_mode_unread).toBe(1);
    expect(after.body.data[0].read_at).toBeGreaterThan(0);
  });

  it("activity lists the audit log with action filter", async () => {
    await api("POST", "/v1/api_keys", { body: { name: "ci" }, headers: H() });
    const r = await dash("GET", "/v1/dashboard/activity");
    expect(r.status).toBe(200);
    expect(r.body.data.map((a: any) => a.action)).toContain("api_key.created");
    expect((await dash("GET", "/v1/dashboard/activity?action=api_key.created")).body.data.every((a: any) => a.action === "api_key.created")).toBe(true);
    expect(r.body.data[0]).toMatchObject({ actor: "dashboard", at: expect.any(Number) });
  });

  it("delete test data removes every livemode=false row for the merchant and keeps live rows and test keys", async () => {
    await ledgerFixture();
    await api("POST", "/v1/products", { key: m.skLive, body: { name: "Live GPU", rate_usd_per_second: "0.004" } });
    const wrong = await dash("POST", "/v1/dashboard/test_data/delete", { confirm_name: "Nope" });
    expect(wrong.status).toBe(400);
    const r = await dash("POST", "/v1/dashboard/test_data/delete", { confirm_name: "Acme GPU" });
    expect(r.status).toBe(200);
    for (const t of ["products", "customers", "subscriptions", "invoices", "ledger_entries", "events", "webhook_endpoints"]) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(t)} WHERE merchant_id = ${m.merchantId} AND livemode = false`;
      expect({ t, n }).toEqual({ t, n: 0 });
    }
    expect((await api("GET", "/v1/products", { key: m.skLive })).body.data).toHaveLength(1);
    expect((await api("GET", "/v1/products", { key: m.skTest })).status).toBe(200); // the test key survives
    const [row] = await sql`SELECT action FROM audit_log WHERE merchant_id = ${m.merchantId} AND action = 'test_data.deleted'`;
    expect(row).toBeTruthy();
  });
});
