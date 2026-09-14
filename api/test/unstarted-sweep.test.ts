import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "../src/db/client";
import { resetDb, seedMerchant, type Fixture } from "./helpers";
import { insertProduct } from "../src/db/products";
import { insertCustomer } from "../src/db/customers";
import { insertSubscription } from "../src/db/subscriptions";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { runUnstartedSweepOnce, UNSTARTED_WINDOW_S } from "../src/worker/unstarted";

/**
 * FR-WRK-075 / FR-API-127: a merchant may hold a subscriber's escrow only so long. A session that
 * was authorised (funded, `incomplete`) but never started for longer than
 * `min(max_duration_seconds, 15 min)` is cancelled by the keeper and refunded in full.
 */

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const NOW = 1_757_000_000;
const at = (s: number) => new Date(s * 1000);
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

async function unstarted(o: {
  address: string;
  createdAt?: number;
  maxDuration?: number;
  status?: string;
  startMode?: "checkout" | "merchant";
  fundedWei?: bigint;
  streamAddress?: string | null;
  startSubmitted?: number | null;
  cancelSubmitted?: number | null;
}): Promise<string> {
  const product = await insertProduct({
    merchantId: m.merchantId, livemode: false, name: "Lambda", description: null,
    rateUsdPerSecond: "0.004", ratePerSecondWei: 4000n, allowPause: true,
  });
  const customer = await insertCustomer({ merchantId: m.merchantId, livemode: false, walletAddress: "0x" + o.address.slice(2, 42) });
  const maxDuration = o.maxDuration ?? 3600;
  const sub = await insertSubscription({
    merchantId: m.merchantId, livemode: false, productId: product.id, customerId: customer.id,
    checkoutSessionId: null, chainId: 10143, ratePerSecondWei: 4000n,
    maxDurationSeconds: maxDuration, maxEscrowWei: 4000n * BigInt(maxDuration),
    startMode: o.startMode ?? "merchant",
    streamAddress: o.streamAddress === undefined ? o.address : o.streamAddress,
    pendingTx: "0x" + "ab".repeat(32), // the funding tx: present on every authorised row
  });
  await sql`UPDATE subscriptions SET
      status = ${o.status ?? "incomplete"},
      created_at = ${at(o.createdAt ?? NOW - 10_000)},
      funded_wei = ${(o.fundedWei ?? 4000n * BigInt(maxDuration)).toString()}::numeric,
      start_submitted_at = ${o.startSubmitted ? at(o.startSubmitted) : null},
      cancel_submitted_at = ${o.cancelSubmitted ? at(o.cancelSubmitted) : null}
    WHERE id = ${sub.id}`;
  return sub.id;
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("FR-WRK-075 unstarted-session sweep", () => {
  it("FR_WRK_075_cancels_a_funded_unstarted_session_past_the_window_exactly_once", async () => {
    const id = await unstarted({ address: addr(1), createdAt: NOW - UNSTARTED_WINDOW_S - 1 });
    const r = await runUnstartedSweepOnce({ now: NOW, log: () => {} });

    expect(r.canceled).toEqual([addr(1)]);
    expect(chain.keeperCancels).toEqual([addr(1)]);

    // The marker is stamped, so the next tick does not cancel it again while the chain confirms.
    const [row] = await sql`SELECT extract(epoch FROM cancel_submitted_at)::int AS t FROM subscriptions WHERE id = ${id}`;
    expect(row.t).toBe(NOW);

    const second = await runUnstartedSweepOnce({ now: NOW + 30, log: () => {} });
    expect(second.canceled).toEqual([]);
    expect(chain.keeperCancels).toHaveLength(1);
  });

  it("FR_WRK_075_leaves_a_session_inside_the_window_alone", async () => {
    await unstarted({ address: addr(2), createdAt: NOW - UNSTARTED_WINDOW_S + 60 });
    const r = await runUnstartedSweepOnce({ now: NOW, log: () => {} });
    expect(r.canceled).toEqual([]);
    expect(chain.keeperCancels).toEqual([]);
  });

  it("FR_API_127_the_window_is_max_duration_capped_at_fifteen_minutes", async () => {
    // A 120 s session is held for at most 120 s, not the full 15 minutes.
    await unstarted({ address: addr(3), maxDuration: 120, createdAt: NOW - 200 });
    // A 10 h session is still capped at 15 minutes.
    await unstarted({ address: addr(4), maxDuration: 36_000, createdAt: NOW - UNSTARTED_WINDOW_S - 1 });
    // A 120 s session only 60 s old is inside its own window.
    await unstarted({ address: addr(5), maxDuration: 120, createdAt: NOW - 60 });

    const r = await runUnstartedSweepOnce({ now: NOW, log: () => {} });
    expect(r.canceled.sort()).toEqual([addr(3), addr(4)].sort());
  });

  it("FR_WRK_075_never_selects_a_started_running_or_already_ended_session", async () => {
    await unstarted({ address: addr(6), status: "active" });
    await unstarted({ address: addr(7), status: "paused" });
    await unstarted({ address: addr(8), status: "canceled" });
    // Checkout-mode rows are started at authorisation; they are not this sweep's business.
    await unstarted({ address: addr(9), startMode: "checkout" });
    // Authorised but the stream never landed: there is nothing funded to refund.
    await unstarted({ address: addr(10), streamAddress: null, fundedWei: 0n });
    // The merchant *did* start it; `active` only arrives when StreamStarted ingests (FR-API-049).
    await unstarted({ address: addr(11), startSubmitted: NOW - 5 });
    // A cancel is already in flight from an earlier tick.
    await unstarted({ address: addr(12), cancelSubmitted: NOW - 5 });

    const r = await runUnstartedSweepOnce({ now: NOW, log: () => {} });
    expect(r.canceled).toEqual([]);
    expect(chain.keeperCancels).toEqual([]);
  });

  it("FR_WRK_075_one_failing_cancel_does_not_stop_the_rest_of_the_batch", async () => {
    await unstarted({ address: addr(13), createdAt: NOW - UNSTARTED_WINDOW_S - 2 });
    await unstarted({ address: addr(14), createdAt: NOW - UNSTARTED_WINDOW_S - 1 });
    chain.failNextCancel = new Error("rpc down");

    const r = await runUnstartedSweepOnce({ now: NOW, log: () => {} });
    expect(r.failed).toBe(1);
    expect(r.canceled).toEqual([addr(14)]);

    // The failed row keeps a null marker, so the next tick retries it.
    const [row] = await sql`SELECT cancel_submitted_at FROM subscriptions WHERE stream_address = ${addr(13)}`;
    expect(row.cancel_submitted_at).toBeNull();
  });
});
