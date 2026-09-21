import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { sql } from "../src/db/client";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { privyFixture } from "./privy-fixture";
import { STREAM, streamCreated, deposited, streamStarted, streamCanceled, streamPaused, settled, T0 } from "./ingest-fixtures";

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
let privy: Awaited<ReturnType<typeof privyFixture>>;
const identity = async () => ({ "x-privy-token": await privy.token(subscriber.address) });
const INGEST = { authorization: "Bearer ingest-test-token" };

async function liveSubscription() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600 }, headers: await identity() });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamCreated(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted(tx) });
  return { subId: prep.body.subscription as string, customerId: prep.body.customer as string, productId: p.body.id as string };
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain({ balances: { [subscriber.address]: 10_000_000_000n } });
  setChainClient(chain.client);
  privy = await privyFixture();
  privy.use();
});
afterEach(() => {
  setChainClient(null);
  privy.off();
});

describe("FR-API-041 retrieve", () => {
  it("FR_API_041_retrieve_returns_the_FR_API_040_object_and_404_across_merchants", async () => {
    const { subId, customerId, productId } = await liveSubscription();
    const r = await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: subId, object: "subscription", status: "active", product: productId, customer: customerId, rate_usd_per_second: "0.004", max_escrow_usd: "14.4", funded_usd: "14.4", stream_address: STREAM, chain_id: 10143, currency: "ausd", livemode: false });
    expect(r.body.seconds_elapsed).toBeGreaterThanOrEqual(0);
    // FR-API-040 (ADR 2026-09-09): the hosted session page, where the subscriber pauses, resumes or stops.
    // FR-API-140(b): the hosted meter page is retired; subscribers manage every meter on /account.
    expect(r.body.manage_url).toBe("http://localhost:3000/account");
    const other = await seedMerchant();
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: other.skTest })).status).toBe(404);
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skLive })).status).toBe(404);
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.pkTest })).status).toBe(401);
  });
});

describe("FR-API-141/142 merchant pause and resume", () => {
  it("FR_API_141_pause_submits_through_the_keeper_and_returns_202_with_the_unchanged_subscription", async () => {
    const { subId } = await liveSubscription();
    const r = await api("POST", `/v1/subscriptions/${subId}/pause`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: subId, object: "subscription", status: "active" });
    expect(r.body.pending_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.keeperPauses).toEqual([STREAM]);
    // Still active until StreamPaused is ingested (BR-API-005).
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.status).toBe("active");
  });

  it("FR_API_141_pause_of_a_subscription_that_is_not_running_is_409", async () => {
    const { subId } = await liveSubscription();
    const tx = "0x" + "cd".repeat(32);
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 10, 10, "40000", "14360000", tx) });
    const r = await api("POST", `/v1/subscriptions/${subId}/pause`, { key: m.skTest });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_running");
    expect(chain.keeperPauses).toEqual([]);
  });

  it("FR_API_142_resume_needs_a_paused_subscription", async () => {
    const { subId } = await liveSubscription();
    // Active: resume is refused and nothing is submitted.
    const early = await api("POST", `/v1/subscriptions/${subId}/resume`, { key: m.skTest });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("not_running");
    expect(chain.keeperResumes).toEqual([]);

    await api("POST", `/v1/subscriptions/${subId}/pause`, { key: m.skTest });
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamPaused(T0 + 5) });
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.status).toBe("paused");

    const r = await api("POST", `/v1/subscriptions/${subId}/resume`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: subId, status: "paused" });
    expect(chain.keeperResumes).toEqual([STREAM]);
  });

  it("FR_API_141_another_merchant_the_other_mode_and_a_publishable_key_cannot_pause", async () => {
    const { subId } = await liveSubscription();
    const other = await seedMerchant();
    expect((await api("POST", `/v1/subscriptions/${subId}/pause`, { key: other.skTest })).status).toBe(404);
    expect((await api("POST", `/v1/subscriptions/${subId}/pause`, { key: m.skLive })).status).toBe(404);
    expect((await api("POST", `/v1/subscriptions/${subId}/pause`, { key: m.pkTest })).status).toBe(401);
    expect(chain.keeperPauses).toEqual([]);
  });
});

describe("FR-API-042 merchant cancel", () => {
  it("FR_API_042_cancel_submits_through_the_keeper_and_returns_202_with_the_unchanged_subscription", async () => {
    const { subId } = await liveSubscription();
    const r = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ id: subId, object: "subscription", status: "active" });
    expect(r.body.pending_tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(chain.keeperCancels).toEqual([STREAM]);
    // Still active until StreamCanceled is ingested (BR-API-005).
    expect((await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.status).toBe("active");
    const tx = r.body.pending_tx as string;
    await api("POST", "/internal/ingest", { headers: INGEST, body: settled(83, "332000", "3320", T0 + 83, tx) });
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 83, 83, "332000", "14068000", tx) });
    const after = await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest });
    expect(after.body).toMatchObject({ status: "canceled", ended_reason: "canceled", seconds_elapsed: 83, settled_usd: "0.332" });
    expect(after.body.manage_url).toBe("http://localhost:3000/account"); // still a string after cancel
    const [ev] = await sql`SELECT data FROM events WHERE type = 'subscription.canceled'`;
    expect(ev.data.object.manage_url).toBe(after.body.manage_url);
  });

  /**
   * FR-API-137/138 require a cancel to stamp `cancel_submitted_at` "so the sweep never sends a
   * second cancel for the same stream" — the reason recorded on 2026-09-15 being that a second
   * submission reverts and burns gas. `cancelAsKeeper` never stamped it, and because the row stays
   * `active` until ingest (BR-API-005) a merchant who pressed Stop twice inside that window sent
   * two keeper transactions. `startAsKeeper` has guarded its own in-flight submit all along.
   */
  it("FR_API_042_a_second_cancel_while_the_first_is_confirming_submits_nothing_new", async () => {
    const { subId } = await liveSubscription();
    expect((await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest })).status).toBe(202);
    expect(chain.keeperCancels).toEqual([STREAM]);
    const [row] = await sql`SELECT cancel_submitted_at FROM subscriptions WHERE id = ${subId}`;
    expect(row.cancel_submitted_at).not.toBeNull();

    // Ingest has not landed, so the row still reads active: the exact window a merchant clicks in.
    const again = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("cancel_in_flight");
    expect(chain.keeperCancels).toEqual([STREAM]);
  });

  it("FR_API_042_a_stop_that_never_confirmed_can_be_sent_again_so_the_meter_is_not_stranded", async () => {
    const { subId } = await liveSubscription();
    await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(chain.keeperCancels).toEqual([STREAM]);
    // The relayer transaction was dropped and never confirmed. Refusing forever would leave the
    // meter running to the escrow cap and overcharge the subscriber, so the guard has to expire.
    await sql`UPDATE subscriptions SET cancel_submitted_at = now() - interval '1 hour' WHERE id = ${subId}`;
    const retry = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(retry.status).toBe(202);
    expect(chain.keeperCancels).toEqual([STREAM, STREAM]);
  });

  it("FR_API_042_cancel_of_an_incomplete_or_canceled_subscription_is_409", async () => {
    const { subId } = await liveSubscription();
    const tx = "0x" + "ab".repeat(32);
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 10, 10, "40000", "14360000", tx) });
    const r = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_running");
    expect(chain.keeperCancels).toEqual([]);
  });
});
