/**
 * FR-API-147/148/149, BR-API-009: the testnet faucet (ADR 2026-10-02). A wallet the API holds sends
 * 15 AUSD to the signed-in subscriber from the Add funds step — in test mode only, limited per
 * wallet, per IP and per day, and bound to testnet in code.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { sql } from "../src/db/client";
import { setChainClient } from "../src/chain/relayer";
import { FAUCET_CHAIN_ID, FAUCET_DROP_UNITS, FAUCET_TOKEN, assertFaucetChain, setFaucetClient } from "../src/chain/faucet";
import { fakeChain } from "./fake-chain";
import { fakeFaucet } from "./fake-faucet";
import { privyFixture } from "./privy-fixture";

let m: Fixture;
let faucet: ReturnType<typeof fakeFaucet>;
let privy: Awaited<ReturnType<typeof privyFixture>>;
const wallet = () => privateKeyToAccount(generatePrivateKey()).address;
const subscriber = wallet();
const identity = async (who: string) => ({ "x-privy-token": await privy.token(who, { email: "sub@example.com" }) });

async function session(livemode = false) {
  const key = livemode ? m.skLive : m.skTest;
  const p = await api("POST", "/v1/products", { key, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  return s.body.id as string;
}

async function drop(id: string, o: { who?: string; ip?: string; livemode?: boolean } = {}) {
  return api("POST", `/v1/checkout/sessions/${id}/faucet`, {
    key: o.livemode ? m.pkLive : m.pkTest,
    headers: { ...(await identity(o.who ?? subscriber)), "x-forwarded-for": o.ip ?? "203.0.113.7" },
  });
}

/** Drops already given, written straight into the record so a limit can be reached without 300 requests. */
async function given(n: number, o: { who?: string; ip?: string; hoursAgo?: number } = {}) {
  for (let i = 0; i < n; i += 1) {
    await sql`INSERT INTO faucet_drops (wallet_address, ip, amount_units, tx_hash, created_at)
              VALUES (${(o.who ?? wallet()).toLowerCase()}, ${o.ip ?? `198.51.100.${i % 250}`}, ${FAUCET_DROP_UNITS.toString()},
                      ${"0x" + "ab".repeat(32)}, now() - make_interval(hours => ${o.hoursAgo ?? 1}))`;
  }
}

const inADay = (resetsAt: number) => Math.abs(resetsAt - (Math.floor(Date.now() / 1000) + 86_400)) < 3_700;

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  setChainClient(fakeChain().client);
  faucet = fakeFaucet();
  setFaucetClient(faucet.client);
  privy = await privyFixture();
  privy.use();
});
afterEach(() => {
  setChainClient(null);
  setFaucetClient(null);
  privy.off();
});

describe("FR-API-147 the testnet faucet", () => {
  it("FR_API_147_drops_15_AUSD_into_the_signed_in_subscribers_wallet_in_a_test_session", async () => {
    const id = await session();
    const r = await drop(id);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ amount_usd: "15", tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(faucet.transfers).toEqual([{ to: subscriber.toLowerCase(), units: 15_000_000n }]);
  });

  it("FR_API_147_refuses_a_live_mode_session_and_sends_nothing", async () => {
    const id = await session(true);
    const r = await drop(id, { livemode: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("faucet_unavailable");
    expect(faucet.transfers).toEqual([]);
  });

  it("FR_API_147_answers_503_when_the_faucet_is_not_configured", async () => {
    setFaucetClient(null); // and FAUCET_PRIVATE_KEY is unset in tests (setup.ts)
    const id = await session();
    const r = await drop(id);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("faucet_unavailable");
  });

  it("FR_API_147_answers_503_and_records_nothing_when_the_faucet_wallet_cannot_pay", async () => {
    const id = await session();
    faucet.failWith(new Error("insufficient funds for gas"));
    const r = await drop(id);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("faucet_unavailable");
    // Nothing was given, so nothing counts against the wallet: once the faucet can pay, it gets its drop.
    faucet.failWith(null);
    expect((await drop(id)).status).toBe(202);
  });

  it("FR_API_147_needs_the_subscribers_identity", async () => {
    const id = await session();
    const r = await api("POST", `/v1/checkout/sessions/${id}/faucet`, { key: m.pkTest });
    expect(r.status).toBe(401);
    expect(faucet.transfers).toEqual([]);
  });
});

describe("FR-API-148 faucet limits", () => {
  it("FR_API_148_one_drop_per_wallet_per_day", async () => {
    const id = await session();
    expect((await drop(id)).status).toBe(202);
    const r = await drop(id);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_wallet_daily");
    expect(inADay(r.body.error.resets_at)).toBe(true);
    expect(faucet.transfers).toHaveLength(1);
  });

  it("FR_API_148_a_drop_older_than_a_day_no_longer_counts", async () => {
    await given(1, { who: subscriber, hoursAgo: 25 });
    expect((await drop(await session())).status).toBe(202);
  });

  it("FR_API_148_refuses_a_wallet_that_already_holds_15_AUSD", async () => {
    const id = await session();
    faucet.balances.set(subscriber.toLowerCase(), 15_000_000n);
    const r = await drop(id);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_wallet_funded");
    expect(r.body.error.resets_at).toBeUndefined(); // it lasts until the wallet spends below 15
    faucet.balances.set(subscriber.toLowerCase(), 14_999_999n);
    expect((await drop(id)).status).toBe(202);
  });

  it("FR_API_148_five_drops_per_ip_per_day", async () => {
    const id = await session();
    for (let i = 0; i < 5; i += 1) expect((await drop(id, { who: wallet(), ip: "192.0.2.10" })).status).toBe(202);
    const r = await drop(id, { who: wallet(), ip: "192.0.2.10" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_ip_daily");
    expect(inADay(r.body.error.resets_at)).toBe(true);
    // Another network is unaffected.
    expect((await drop(id, { who: wallet(), ip: "192.0.2.11" })).status).toBe(202);
  });

  it("FR_API_148_three_hundred_drops_across_the_faucet_per_day", async () => {
    await given(299);
    const id = await session();
    expect((await drop(id, { who: wallet() })).status).toBe(202); // the 300th
    const r = await drop(id, { who: wallet(), ip: "192.0.2.99" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("faucet_daily");
    expect(inADay(r.body.error.resets_at)).toBe(true);
  });

  it("FR_API_148_drops_go_out_one_at_a_time", async () => {
    const id = await session();
    faucet.slow(40);
    const results = await Promise.all([drop(id, { who: wallet() }), drop(id, { who: wallet() }), drop(id, { who: wallet() })]);
    expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
    expect(faucet.maxInFlight).toBe(1);
  });

  it("FR_API_148_two_presses_at_once_from_one_wallet_give_one_drop", async () => {
    const id = await session();
    faucet.slow(40);
    const results = await Promise.all([drop(id), drop(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(faucet.transfers).toHaveLength(1);
  });
});

describe("FR-API-149 the balance says whether to offer the faucet", () => {
  const balance = async (id: string, livemode = false) =>
    api("GET", `/v1/checkout/sessions/${id}/balance`, { key: livemode ? m.pkLive : m.pkTest, headers: await identity(subscriber) });

  it("FR_API_149_offers_15_in_a_test_session_when_the_faucet_is_configured", async () => {
    expect((await balance(await session())).body.faucet_amount_usd).toBe("15");
  });

  it("FR_API_149_offers_nothing_without_the_key", async () => {
    setFaucetClient(null);
    expect((await balance(await session())).body.faucet_amount_usd).toBeNull();
  });

  it("FR_API_149_offers_nothing_in_live_mode", async () => {
    expect((await balance(await session(true), true)).body.faucet_amount_usd).toBeNull();
  });
});

describe("BR-API-009 the faucet can never move real money", () => {
  it("BR_API_009_is_bound_to_testnet_AUSD_in_code", () => {
    expect(FAUCET_CHAIN_ID).toBe(10143);
    expect(FAUCET_TOKEN.toLowerCase()).toBe("0xa9012a055bd4e0edff8ce09f960291c09d5322dc");
    expect(FAUCET_DROP_UNITS).toBe(15_000_000n);
  });

  it("BR_API_009_refuses_to_send_on_any_other_chain", () => {
    expect(() => assertFaucetChain(10143)).not.toThrow();
    expect(() => assertFaucetChain(143)).toThrow(/testnet/);
  });
});
