import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { STREAM, streamCreated, deposited, streamStarted, streamCanceled, T0 } from "./ingest-fixtures";
import { privyFixture } from "./privy-fixture";
import { UNSTARTED_WINDOW_S, runUnstartedSweepOnce } from "../src/worker/unstarted";

/**
 * FR-API-137/138 (signed 2026-09-16): what the subscriber sees of a merchant-mode session they have
 * authorised and funded but the merchant has not started yet — the held state.
 */

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());
let privy: Awaited<ReturnType<typeof privyFixture>>;
const identity = async (wallet = subscriber.address) => ({ "x-privy-token": await privy.token(wallet) });
const INGEST = { authorization: "Bearer ingest-test-token" };

/** Authorised and funded on a merchant-mode product, never started: prepare, start, ingest create + deposit only. */
async function heldSession(opts: { maxDuration?: number; startMode?: "checkout" | "merchant"; funded?: boolean } = {}) {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "Lambda", rate_usd_per_second: "0.002", start_mode: opts.startMode ?? "merchant" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  const prep = await api("POST", `/v1/checkout/sessions/${s.body.id}/prepare`, { key: m.pkTest, body: { max_duration_seconds: opts.maxDuration ?? 3600 }, headers: await identity() });
  const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: BigInt(prep.body.permit.message.nonce ?? 0), deadline: BigInt(prep.body.permit.message.deadline) } });
  if (opts.funded === false) return { sessionId: s.body.id as string, subId: prep.body.subscription as string };
  const start = await api("POST", `/v1/checkout/sessions/${s.body.id}/start`, { key: m.pkTest, body: { signature } });
  const tx: string = start.body.pending_tx;
  await api("POST", "/internal/ingest", { headers: INGEST, body: { ...streamCreated(tx), args: { ...streamCreated(tx).args, subscriber: subscriber.address.toLowerCase() } } });
  await api("POST", "/internal/ingest", { headers: INGEST, body: deposited(tx) });
  return { sessionId: s.body.id as string, subId: prep.body.subscription as string };
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

describe("FR-API-137 start mode and refund-by time for the subscriber", () => {
  it("FR_API_137_the_public_session_of_a_held_subscription_carries_start_mode_and_the_sweep_cutoff", async () => {
    const { sessionId, subId } = await heldSession();
    const created: number = (await api("GET", `/v1/subscriptions/${subId}`, { key: m.skTest })).body.created;

    const pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(pub.status).toBe(200);
    expect(pub.body.subscription.status).toBe("incomplete");
    expect(pub.body.subscription.start_mode).toBe("merchant");
    // The same window the FR-WRK-075 sweep refunds on: min(max_duration_seconds, UNSTARTED_WINDOW_S).
    expect(pub.body.subscription.start_by).toBe(created + Math.min(3600, UNSTARTED_WINDOW_S));
  });
  it("FR_API_137_the_subscriber_cannot_stop_a_held_session_amended_2026_09_19", async () => {
    // The merchant's meter is the merchant's to stop, before it starts as well as after
    // (contracts FR-CON-057, ADR 2026-09-19). The sweep and the merchant are the ways out.
    const { sessionId } = await heldSession();
    chain.setRelayNonce(STREAM, 0n);

    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel/prepare`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(prep.status).toBe(409);
    expect(prep.body.error.code).toBe("merchant_controlled");
    expect(chain.cancels).toEqual([]);
  });

  it("FR_API_137_the_unstarted_sweep_still_refunds_a_held_session_in_full", async () => {
    const { subId } = await heldSession();
    const swept = await runUnstartedSweepOnce({ now: Math.floor(Date.now() / 1000) + 86_400, log: () => {} });
    expect(swept.canceled).toEqual([STREAM]);
    expect(chain.keeperCancels).toEqual([STREAM]);
    expect(subId).toMatch(/^sub_/);
  });

  it("FR_API_137_the_merchant_can_still_release_a_held_session", async () => {
    const { subId } = await heldSession();
    const res = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(res.status).toBe(202);
    expect(chain.keeperCancels).toEqual([STREAM]);
  });

  it("FR_API_137_a_checkout_mode_session_is_refused_for_having_no_meter_not_for_being_the_merchant_s", async () => {
    // A checkout-mode session starts at authorisation, so an unstarted one has no meter at all.
    // The distinction matters: `merchant_controlled` would tell the subscriber the wrong story.
    const { sessionId } = await heldSession({ startMode: "checkout" });
    chain.setRelayNonce(STREAM, 0n);
    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/cancel/prepare`, { key: m.pkTest, body: {}, headers: await identity() });
    expect(prep.status).toBe(409);
    expect(prep.body.error.code).toBe("not_running");
  });
});

describe("FR-API-137 the product's start mode before anything is authorised", () => {
  it("FR_API_137_the_public_session_product_says_whether_billing_waits_for_the_merchant", async () => {
    for (const mode of ["merchant", "checkout"] as const) {
      const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: `P ${mode}`, rate_usd_per_second: "0.002", start_mode: mode } });
      const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
      const pub = await api("GET", `/v1/checkout/sessions/${s.body.id}`, { key: m.pkTest });
      // No subscription yet: the cap step reads the mode from the product (checkout FR-CHK-035).
      expect(pub.body.subscription).toBeNull();
      expect(pub.body.product.start_mode).toBe(mode);
    }
  });
});

describe("FR-API-138 /account lists held money", () => {
  it("FR_API_138_lists_a_funded_unstarted_merchant_row_with_its_refund_time_and_hides_other_incomplete_rows", async () => {
    const held = await heldSession();
    const unfunded = await heldSession({ funded: false });
    const checkoutMode = await heldSession({ startMode: "checkout" });

    const r = await api("GET", "/v1/account/subscriptions", { headers: await identity() });
    expect(r.status).toBe(200);
    const ids = r.body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(held.subId);
    expect(ids).not.toContain(unfunded.subId);
    expect(ids).not.toContain(checkoutMode.subId);

    const row = r.body.data.find((d: { id: string }) => d.id === held.subId);
    const created: number = (await api("GET", `/v1/subscriptions/${held.subId}`, { key: m.skTest })).body.created;
    expect(row).toMatchObject({ status: "incomplete", start_mode: "merchant", start_by: created + Math.min(3600, UNSTARTED_WINDOW_S) });
  });

  it("FR_API_138_the_account_cannot_stop_a_held_meter_amended_2026_09_19", async () => {
    // /account is Elapse's own page, and it is bound by the same rule as the merchant's:
    // a merchant-started meter is the merchant's to stop, before it starts as well as after.
    const held = await heldSession();
    chain.setRelayNonce(STREAM, 0n);
    const prep = await api("POST", `/v1/account/subscriptions/${held.subId}/cancel/prepare`, { body: {}, headers: await identity() });
    expect(prep.status).toBe(409);
    expect(prep.body.error.code).toBe("merchant_controlled");
    expect(chain.cancels).toEqual([]);

    // And the sweep is still there to refund it.
    const swept = await runUnstartedSweepOnce({ now: Math.floor(Date.now() / 1000) + 86_400, log: () => {} });
    expect(swept.canceled).toEqual([STREAM]);
  });
});

describe("FR-API-139 only the merchant stops a started merchant-mode meter", () => {
  async function startedSession() {
    const held = await heldSession();
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted() });
    return held;
  }

  const signed = () => ({ signature: "0x" + "ab".repeat(65), deadline: String(Math.floor(Date.now() / 1000) + 300) });

  it("FR_API_139_every_subscriber_stop_route_answers_409_and_nothing_reaches_the_chain", async () => {
    const { sessionId, subId } = await startedSession();
    chain.setRelayNonce(STREAM, 0n);
    const headers = await identity();
    const routes: Array<[string, Record<string, unknown>]> = [
      [`/v1/checkout/sessions/${sessionId}/cancel/prepare`, {}],
      [`/v1/checkout/sessions/${sessionId}/cancel`, signed()],
      [`/v1/account/subscriptions/${subId}/cancel/prepare`, {}],
      [`/v1/account/subscriptions/${subId}/cancel`, signed()],
    ];
    for (const [path, body] of routes) {
      const r = await api("POST", path, { ...(path.startsWith("/v1/checkout") ? { key: m.pkTest } : {}), body, headers });
      expect({ path, status: r.status, code: r.body.error?.code }).toEqual({ path, status: 409, code: "merchant_controlled" });
    }
    expect(chain.cancels).toEqual([]);
  });

  it("FR_API_044_the_subscriber_pause_and_resume_routes_do_not_exist_at_all", async () => {
    // Withdrawn 2026-09-20 (signed, ADR 2026-09-20 subscriber-cannot-pause): pausing is the
    // merchant's on every product, so these routes were deleted rather than made to refuse.
    // A subscriber who asks wants a 404, not a 409 — there is nothing here to be refused from.
    const { sessionId, subId } = await startedSession();
    chain.setRelayNonce(STREAM, 0n);
    const headers = await identity();
    const routes: Array<[string, Record<string, unknown>]> = [];
    for (const action of ["pause", "resume"]) {
      routes.push([`/v1/checkout/sessions/${sessionId}/${action}/prepare`, {}]);
      routes.push([`/v1/checkout/sessions/${sessionId}/${action}`, signed()]);
      routes.push([`/v1/account/subscriptions/${subId}/${action}/prepare`, {}]);
      routes.push([`/v1/account/subscriptions/${subId}/${action}`, signed()]);
    }
    for (const [path, body] of routes) {
      const r = await api("POST", path, { ...(path.startsWith("/v1/checkout") ? { key: m.pkTest } : {}), body, headers });
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    expect(chain.pauses).toEqual([]);
    expect(chain.resumes).toEqual([]);
  });

  it("FR_API_139_the_public_session_says_whether_the_subscriber_can_stop", async () => {
    const held = await heldSession();
    let pub = await api("GET", `/v1/checkout/sessions/${held.sessionId}`, { key: m.pkTest });
    expect(pub.body.subscription.subscriber_can_stop).toBe(true); // held: a full refund is still theirs to take

    await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted() });
    pub = await api("GET", `/v1/checkout/sessions/${held.sessionId}`, { key: m.pkTest });
    expect(pub.body.subscription.status).toBe("active");
    expect(pub.body.subscription.subscriber_can_stop).toBe(false);
  });

  it("FR_API_139_the_merchant_can_still_cancel_through_the_api", async () => {
    const { subId } = await startedSession();
    const r = await api("POST", `/v1/subscriptions/${subId}/cancel`, { key: m.skTest });
    expect(r.status).toBe(202);
    expect(chain.keeperCancels).toEqual([STREAM]);
  });
});

describe("FR-API-143 the meter's two transactions on the public session", () => {
  it("FR_API_143_start_tx_and_end_tx_arrive_with_their_logs_and_are_null_before", async () => {
    const { sessionId } = await heldSession();
    const pk = { key: m.pkTest };

    let pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, pk);
    expect(pub.body.subscription.start_tx).toBeNull();
    expect(pub.body.subscription.end_tx).toBeNull();

    const startTx = "0x" + "11".repeat(32);
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamStarted(startTx, T0) });
    pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, pk);
    expect(pub.body.subscription.start_tx).toBe(startTx);
    expect(pub.body.subscription.end_tx).toBeNull();

    const endTx = "0x" + "22".repeat(32);
    await api("POST", "/internal/ingest", { headers: INGEST, body: streamCanceled(T0 + 3, 3, "12000", "7188000", endTx) });
    pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, pk);
    // The start is still there: the drop for the end must not overwrite the proof of the start.
    expect(pub.body.subscription.start_tx).toBe(startTx);
    expect(pub.body.subscription.end_tx).toBe(endTx);
  });

  it("FR_API_143_adds_only_the_two_named_transactions", async () => {
    // `pending_tx` stays out: it holds whatever was submitted last and is never cleared, so after
    // a stop it would still be the start's hash and the drop would lie.
    const { sessionId } = await heldSession();
    const pub = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(pub.body.subscription).not.toHaveProperty("pending_tx");
    expect(pub.body.subscription).toHaveProperty("start_tx");
    expect(pub.body.subscription).toHaveProperty("end_tx");
  });
});
