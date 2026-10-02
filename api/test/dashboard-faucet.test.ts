/**
 * FR-API-150/151: the faucet's second door, on the merchant dashboard (ADR 2026-10-02 dashboard
 * faucet). A signed-in merchant sends 15 test AUSD to any address, under the checkout faucet's
 * shared limits plus three drops per merchant per day.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { createSession } from "../src/db/sessions";
import { sql } from "../src/db/client";
import { setFaucetClient } from "../src/chain/faucet";
import { fakeFaucet } from "./fake-faucet";

const ORIGIN = "http://localhost:3000";
let m: Fixture;
let cookie: string;
let faucet: ReturnType<typeof fakeFaucet>;
const address = () => privateKeyToAccount(generatePrivateKey()).address;

const send = (to: string, o: { mode?: "test" | "live"; ip?: string; as?: string } = {}) =>
  api("POST", "/v1/dashboard/faucet", {
    body: { address: to },
    headers: { cookie: o.as ?? cookie, origin: ORIGIN, "x-elapse-mode": o.mode ?? "test", "x-forwarded-for": o.ip ?? "203.0.113.20" },
  });

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  cookie = `elapse_session=${(await createSession(m.merchantId, null)).token}`;
  faucet = fakeFaucet();
  setFaucetClient(faucet.client);
});
afterEach(() => setFaucetClient(null));

describe("FR-API-150 dashboard faucet", () => {
  it("FR_API_150_sends_15_AUSD_to_the_address_the_merchant_names_in_test_mode", async () => {
    const to = address();
    const r = await send(to);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ amount_usd: "15", tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(faucet.transfers).toEqual([{ to: to.toLowerCase(), units: 15_000_000n }]);
  });

  it("FR_API_150_refuses_live_mode_and_sends_nothing", async () => {
    const r = await send(address(), { mode: "live" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("faucet_unavailable");
    expect(faucet.transfers).toEqual([]);
  });

  it("FR_API_150_refuses_a_secret_key_the_door_is_the_dashboard_only", async () => {
    const r = await api("POST", "/v1/dashboard/faucet", { key: m.skTest, body: { address: address() } });
    expect(r.status).toBe(401);
    expect(faucet.transfers).toEqual([]);
  });

  it("FR_API_150_refuses_a_malformed_or_mis_checksummed_address_before_sending", async () => {
    for (const bad of ["0x123", "not an address", "0x2dc833BDE673AA92Bd9fea75B71B1CEd3F0D0241".replace("2dc8", "2DC8")]) {
      const r = await send(bad);
      expect(r.status).toBe(400);
      expect(r.body.error.param).toBe("address");
    }
    expect(faucet.transfers).toEqual([]);
  });

  it("FR_API_150_answers_503_without_the_faucet_key", async () => {
    setFaucetClient(null);
    const r = await send(address());
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("faucet_unavailable");
  });
});

describe("FR-API-151 dashboard faucet limits and record", () => {
  it("FR_API_151_three_drops_per_merchant_per_day", async () => {
    // Different addresses and networks, so only the per-merchant limit can stop the fourth.
    for (let i = 0; i < 3; i += 1) expect((await send(address(), { ip: `192.0.2.${i}` })).status).toBe(202);
    const r = await send(address(), { ip: "192.0.2.50" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_merchant_daily");
    expect(Math.abs(r.body.error.resets_at - (Math.floor(Date.now() / 1000) + 86_400))).toBeLessThan(3_700);
    expect(faucet.transfers).toHaveLength(3);
    // Another merchant is unaffected.
    const other = await seedMerchant();
    const otherCookie = `elapse_session=${(await createSession(other.merchantId, null)).token}`;
    expect((await send(address(), { ip: "192.0.2.51", as: otherCookie })).status).toBe(202);
  });

  it("FR_API_151_shares_the_receiving_address_limit_with_the_checkout_door", async () => {
    const to = address();
    await sql`INSERT INTO faucet_drops (wallet_address, ip, amount_units, tx_hash, merchant_id, via)
              VALUES (${to.toLowerCase()}, '198.51.100.1', 15000000, ${"0x" + "ab".repeat(32)}, ${m.merchantId}, 'checkout')`;
    const r = await send(to);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_wallet_daily");
  });

  it("FR_API_151_drops_subscribers_took_in_the_merchants_checkouts_do_not_count_toward_its_three", async () => {
    for (let i = 0; i < 5; i += 1) {
      await sql`INSERT INTO faucet_drops (wallet_address, ip, amount_units, tx_hash, merchant_id, via)
                VALUES (${address().toLowerCase()}, ${`198.51.100.${i}`}, 15000000, ${"0x" + "ab".repeat(32)}, ${m.merchantId}, 'checkout')`;
    }
    expect((await send(address())).status).toBe(202);
  });

  it("FR_API_151_records_the_merchant_and_writes_an_audit_row", async () => {
    const to = address();
    expect((await send(to)).status).toBe(202);
    const [drop] = await sql`SELECT merchant_id, via FROM faucet_drops`;
    expect(drop).toEqual({ merchant_id: m.merchantId, via: "dashboard" });
    const audit = await sql`SELECT actor, action, target FROM audit_log WHERE merchant_id = ${m.merchantId} AND action = 'faucet_drop'`;
    expect(audit).toEqual([{ actor: "dashboard", action: "faucet_drop", target: to.toLowerCase() }]);
  });

  it("FR_API_151_a_refused_drop_writes_no_audit_row", async () => {
    setFaucetClient(null);
    await send(address());
    expect(await sql`SELECT 1 FROM audit_log WHERE action = 'faucet_drop'`).toHaveLength(0);
  });
});

