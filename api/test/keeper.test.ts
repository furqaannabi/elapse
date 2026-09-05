import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { resetDb, seedMerchant, type Fixture } from "./helpers";
import { insertProduct } from "../src/db/products";
import { insertCustomer } from "../src/db/customers";
import { insertSubscription } from "../src/db/subscriptions";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { runKeeperOnce, KEEPER_CADENCE_S } from "../src/worker/keeper";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const NOW = 1_757_000_000;
const at = (s: number) => new Date(s * 1000);

async function stream(opts: { status?: string; startedAt?: number; maxDuration?: number; lastSettle?: number | null; address: string; paused?: number }) {
  const product = await insertProduct({ merchantId: m.merchantId, livemode: false, name: "GPU", description: null, rateUsdPerSecond: "0.004", ratePerSecondWei: 4000n, allowPause: true });
  const customer = await insertCustomer({ merchantId: m.merchantId, livemode: false, walletAddress: "0x" + opts.address.slice(2, 42) });
  const sub = await insertSubscription({ merchantId: m.merchantId, livemode: false, productId: product.id, customerId: customer.id, checkoutSessionId: null, chainId: 10143, ratePerSecondWei: 4000n, maxDurationSeconds: opts.maxDuration ?? 3600, maxEscrowWei: 4000n * BigInt(opts.maxDuration ?? 3600), streamAddress: opts.address });
  await sql`UPDATE subscriptions SET status = ${opts.status ?? "active"}, started_at = ${at(opts.startedAt ?? NOW - 60)}, paused_seconds = ${opts.paused ?? 0},
            last_settle_requested_at = ${opts.lastSettle === undefined || opts.lastSettle === null ? null : at(opts.lastSettle)} WHERE id = ${sub.id}`;
  return sub.id;
}
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-WRK-070 keeper", () => {
  it("FR_WRK_070_settles_active_streams_whose_last_settle_is_older_than_the_cadence", async () => {
    const due = await stream({ address: addr(1), startedAt: NOW - 1000, lastSettle: NOW - KEEPER_CADENCE_S - 1 });
    const fresh = await stream({ address: addr(2), startedAt: NOW - 1000, lastSettle: NOW - 30 });
    const young = await stream({ address: addr(3), startedAt: NOW - 30, lastSettle: null }); // never settled, but started 30 s ago
    const old = await stream({ address: addr(4), startedAt: NOW - KEEPER_CADENCE_S - 5, lastSettle: null });
    const r = await runKeeperOnce({ now: NOW });
    expect(r.settled.sort()).toEqual([addr(1), addr(4)].sort());
    expect(chain.settleBatches).toHaveLength(1);
    expect(chain.settleBatches[0]!.streams.sort()).toEqual([addr(1), addr(4)].sort());
    const [a] = await sql`SELECT extract(epoch FROM last_settle_requested_at)::int AS t FROM subscriptions WHERE id = ${due}`;
    expect(a.t).toBe(NOW);
    const [b] = await sql`SELECT extract(epoch FROM last_settle_requested_at)::int AS t FROM subscriptions WHERE id = ${fresh}`;
    expect(b.t).toBe(NOW - 30);
    void young; void old;
  });

  it("FR_WRK_071_a_stream_past_its_cap_is_settled_at_once_so_the_cap_end_is_emitted", async () => {
    await stream({ address: addr(5), startedAt: NOW - 400, maxDuration: 300, lastSettle: NOW - 10 });
    await stream({ address: addr(6), startedAt: NOW - 400, maxDuration: 300, lastSettle: NOW - 10, paused: 200 }); // 200 s paused: not yet at cap
    const r = await runKeeperOnce({ now: NOW });
    expect(r.settled).toEqual([addr(5)]);
  });

  it("FR_WRK_070_ignores_paused_canceled_and_incomplete_streams_and_chunks_by_50", async () => {
    await stream({ address: addr(7), status: "paused", lastSettle: NOW - 10_000 });
    await stream({ address: addr(8), status: "canceled", lastSettle: NOW - 10_000 });
    await stream({ address: addr(9), status: "incomplete", lastSettle: null, startedAt: NOW - 10_000 });
    for (let i = 10; i < 65; i++) await stream({ address: addr(i), startedAt: NOW - 10_000, lastSettle: null });
    const r = await runKeeperOnce({ now: NOW, batch: 50 });
    expect(r.settled).toHaveLength(55);
    expect(chain.settleBatches.map((b) => b.streams.length)).toEqual([50, 5]);
  });

  it("FR_WRK_070_a_failed_batch_is_logged_and_leaves_the_rows_untouched_for_the_next_tick", async () => {
    await stream({ address: addr(20), startedAt: NOW - 10_000, lastSettle: null });
    chain.failNextSettle = new Error("rpc down");
    const r = await runKeeperOnce({ now: NOW, log: () => {} });
    expect(r.settled).toEqual([]);
    expect(r.failed).toBe(1);
    const [row] = await sql`SELECT last_settle_requested_at FROM subscriptions WHERE stream_address = ${addr(20)}`;
    expect(row.last_settle_requested_at).toBeNull();
  });
});
