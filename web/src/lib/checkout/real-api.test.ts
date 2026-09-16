import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealCheckoutApi, mapSession, type SubscriberWallet } from "./real-api";

const BASE = "http://api.test";
const T0 = 1_757_000_000;

function wireSession(over: Record<string, unknown> = {}) {
  return {
    id: "cs_abc",
    object: "checkout.session",
    status: "open",
    expires_at: T0 + 86_400,
    merchant: { name: "Nimbus", logo_url: null, accent: null, support_url: "https://n.example/help", success_url: "https://n.example/ok", cancel_url: "https://n.example/no" },
    product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: false, active: true },
    customer: null,
    subscription: null,
    max_duration_seconds: null,
    max_escrow_usd: null,
    ...over,
  };
}
const wireSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", object: "subscription", status: "incomplete", product: "prod_1", customer: "cus_1", checkout_session: "cs_abc",
  rate_usd_per_second: "0.004", started_at: null, paused_at: null, canceled_at: null, ended_reason: null,
  max_duration_seconds: 3600, max_escrow_usd: "14.4", funded_usd: "0", settled_usd: "0", seconds_elapsed: 0,
  stream_address: null, chain_id: 10143, currency: "ausd", livemode: false, created: T0, ...over,
});

let calls: Array<{ method: string; url: string; body?: unknown; headers?: Record<string, string> }>;
let responses: Array<unknown | ((c: { url: string; body?: unknown }) => unknown)>;
const wallet: SubscriberWallet = {
  address: "0x2222222222222222222222222222222222222222",
  signTypedData: vi.fn(async () => ("0x" + "ab".repeat(65)) as `0x${string}`),
  signMessage: vi.fn(async () => ("0x" + "cd".repeat(65)) as `0x${string}`),
};

beforeEach(() => {
  tokens = [];
  identityToken.mockClear();
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    const next = responses.shift() ?? wireSession();
    const payload = typeof next === "function" ? (next as (c: { url: string; body?: unknown }) => unknown)({ url: String(url), body }) : next;
    const status = (payload as { __status?: number }).__status ?? 200;
    return new Response(JSON.stringify(payload), { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

let tokens: (string | null)[];
const identityToken = vi.fn(async () => (tokens.length ? tokens.shift()! : "tok_fresh"));
const api = () => createRealCheckoutApi({ baseUrl: BASE, wallet: () => wallet, identityToken, sleep: async () => {} });

describe("mapSession", () => {
  it("maps the public projection to the page's types", () => {
    const s = mapSession(wireSession({ customer: { id: "cus_1", email: "a@b.c" }, subscription: wireSub({ status: "active", started_at: T0, stream_address: "0x1" }) }) as never);
    expect(s).toMatchObject({
      id: "cs_abc", status: "open", expiresAt: (T0 + 86_400) * 1000,
      merchant: { name: "Nimbus", successUrl: "https://n.example/ok", cancelUrl: "https://n.example/no", supportUrl: "https://n.example/help" },
      product: { id: "prod_1", rateUsdPerSecond: "0.004", allowPause: false, status: "active" },
      customer: { id: "cus_1", email: "a@b.c" },
      subscription: { id: "sub_1", status: "active", startedAt: T0 * 1000, pausedAt: null, canceledAt: null, maxDurationSeconds: 3600, fundedUsd: "14.4", rateUsdPerSecond: "0.004" },
    });
    expect(s.merchant.logoUrl).toBeUndefined();
  });
  it("an archived product and a cap end map to the page's words", () => {
    const s = mapSession(wireSession({ product: { id: "prod_1", name: "GPU", rate_usd_per_second: "0.004", allow_pause: true, active: false }, subscription: wireSub({ status: "canceled", ended_reason: "cap_reached", started_at: T0, canceled_at: T0 + 3600 }) }) as never);
    expect(s.product.status).toBe("archived");
    expect(s.subscription).toMatchObject({ status: "canceled", endedReason: "cap_reached", canceledAt: (T0 + 3600) * 1000 });
  });
  it("BR_CHK_003_a_stopped_subscription_carries_the_server_totals_so_paused_time_is_not_recounted", () => {
    // 105 s wall clock, 31 s of it paused: the chain settled 74 s. The page must show 74, not 105.
    const s = mapSession(wireSession({ subscription: wireSub({ status: "canceled", ended_reason: "canceled", started_at: T0, canceled_at: T0 + 105, paused_at: null, funded_usd: "7.2", max_escrow_usd: "7.2", rate_usd_per_second: "0.002", settled_usd: "0.148", seconds_elapsed: 74 }) }) as never);
    expect(s.subscription?.settled).toEqual({ secondsElapsed: 74, settledUsd: "0.148" });
  });
});

describe("real CheckoutApi", () => {
  it("getSession fetches the public projection and maps 404 to not_found", async () => {
    const s = await api().getSession("cs_abc");
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/v1/checkout/sessions/cs_abc` });
    expect(s.id).toBe("cs_abc");
    responses = [{ __status: 404, error: { type: "not_found", message: "No such checkout session" } }];
    await expect(api().getSession("cs_zzz")).rejects.toMatchObject({ code: "not_found" });
  });

  it("signIn marks the session signed in locally; the customer is created by prepare", async () => {
    const a = api();
    const s = await a.signIn("cs_abc", { email: "a@b.c" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(s.signedIn).toBe(true);
    expect(s.customer).toBeNull();
  });

  it("setCap calls prepare with the wallet address and shows the pot as fundedUsd", async () => {
    const a = api();
    tokens = ["tok_1"];
    await a.signIn("cs_abc", { email: "a@b.c" });
    responses = [
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: {}, types: {}, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "0", deadline: String(T0 + 600) } } },
      wireSession({ customer: { id: "cus_1", email: "a@b.c" }, subscription: wireSub() }),
    ];
    const s = await a.setCap("cs_abc", 3600);
    // FR-CHK-027: the identity token proves who is preparing; wallet and email are never in the body.
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: `${BASE}/v1/checkout/sessions/cs_abc/prepare`, body: { max_duration_seconds: 3600 }, headers: { "x-privy-token": "tok_1" } });
    expect(calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("wallet_address");
    expect(calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("email");
    expect(s.subscription).toMatchObject({ status: "incomplete", fundedUsd: "14.4", maxDurationSeconds: 3600 });
  });

  it("start signs the permit, posts it, and polls until the subscription is active", async () => {
    const a = api();
    await a.signIn("cs_abc", {});
    responses = [
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: {}, types: {}, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "0", deadline: String(T0 + 600) } } },
      wireSession({ customer: { id: "cus_1", email: null }, subscription: wireSub() }),
    ];
    await a.setCap("cs_abc", 3600);
    responses = [
      wireSession({ customer: { id: "cus_1", email: null }, subscription: wireSub() }),
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: { name: "Mock USD", version: "1", chainId: 10143, verifyingContract: "0xt" }, types: { Permit: [] }, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "1", deadline: String(T0 + 700) } } },
      { subscription: "sub_1", pending_tx: "0x" + "11".repeat(32) },
      wireSession({ customer: { id: "cus_1", email: null }, subscription: wireSub() }),
      wireSession({ customer: { id: "cus_1", email: null }, subscription: wireSub() }),
      wireSession({ status: "complete", customer: { id: "cus_1", email: null }, subscription: wireSub({ status: "active", started_at: T0, stream_address: "0x1" }) }),
    ];
    calls = [];
    const s = await a.start("cs_abc");
    expect(wallet.signTypedData).toHaveBeenCalledTimes(1);
    const startCall = calls.find((c) => c.url.endsWith("/start"));
    expect(startCall?.body).toEqual({ signature: "0x" + "ab".repeat(65) });
    expect(s.subscription?.status).toBe("active");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(4); // read, then three polls
  });

  it("cancel fetches the message, signs it, posts it, polls to canceled, and builds the receipt", async () => {
    const a = api();
    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "0", deadline: String(T0 + 600), message: "0x" + "ee".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "22".repeat(32) },
      wireSession({ status: "complete", customer: { id: "cus_1", email: null }, subscription: wireSub({ status: "active", started_at: T0, stream_address: "0x1" }) }),
      wireSession({ status: "complete", customer: { id: "cus_1", email: null }, subscription: wireSub({ status: "canceled", ended_reason: "canceled", started_at: T0, canceled_at: T0 + 83, settled_usd: "0.332", seconds_elapsed: 83, stream_address: "0x1" }) }),
    ];
    const r = await a.cancel("cs_abc");
    expect(wallet.signMessage).toHaveBeenCalledWith("0x" + "ee".repeat(32));
    expect(calls.find((c) => c.url.endsWith("/cancel"))?.body).toEqual({ signature: "0x" + "cd".repeat(65), deadline: String(T0 + 600) });
    expect(r.session.subscription?.status).toBe("canceled");
    expect(r.receipt).toMatchObject({ secondsElapsed: 83, amountSettledUsd: "0.332", refundedUsd: "14.068", endedReason: "canceled" });
  });

  it("FR_CHK_029_emailReceipt_posts_to_the_account_route_for_the_sessions_subscription_and_maps_the_rate_limit", async () => {
    const a = api();
    responses = [
      wireSession({ status: "complete", subscription: wireSub({ status: "canceled", started_at: T0, canceled_at: T0 + 83, settled_usd: "0.332", seconds_elapsed: 83 }) }),
      { sent: true },
    ];
    expect(await a.emailReceipt("cs_abc", "a@b.co")).toEqual({ sent: true });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`${BASE}/v1/account/subscriptions/sub_1/receipt/email`);
    expect(post.headers?.["x-privy-token"]).toBe("tok_fresh");
    responses = [
      wireSession({ status: "complete", subscription: wireSub({ status: "canceled", started_at: T0, canceled_at: T0 + 83 }) }),
      { __status: 429, error: { type: "rate_limit_error", code: "receipt_already_sent", message: "Already sent. Check your inbox." } },
    ];
    await expect(a.emailReceipt("cs_abc", "a@b.co")).rejects.toMatchObject({ code: "already_sent", message: "Already sent. Check your inbox." });
  });

  it("FR_CHK_007_startAgain_posts_to_again_with_the_token_and_the_new_session_carries_the_last_cap", async () => {
    const a = api();
    responses = [{ id: "cs_new", url: `${BASE}/c/cs_new` }, wireSession({ id: "cs_new", last_max_duration_seconds: 3600 })];
    const next = await a.startAgain("cs_abc");
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/checkout/sessions/cs_abc/again` });
    expect(calls[0]!.headers?.["x-privy-token"]).toBe("tok_fresh");
    expect(next.id).toBe("cs_new");
    expect(next.lastMaxDurationSeconds).toBe(3600);
    responses = [wireSession({ restarted_as: "cs_new" })];
    expect((await a.getSession("cs_abc")).restartedAs).toBe("cs_new");
    responses = [{ __status: 400, error: { type: "invalid_request_error", code: "product_archived", message: "This product is no longer available." } }];
    await expect(a.startAgain("cs_abc")).rejects.toMatchObject({ message: "This product is no longer available." });
  });

  it("API errors carry the server message", async () => {
    responses = [{ __status: 409, error: { type: "invalid_request_error", code: "already_started", message: "This session has already started." } }];
    await expect(api().start("cs_abc")).rejects.toMatchObject({ code: "invalid_state", message: "This session has already started." });
  });

  it("FR_CHK_030_pause_fetches_the_message_signs_it_posts_it_and_polls_to_paused_then_resume_polls_to_active", async () => {
    const a = api();
    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "3", deadline: String(T0 + 600), message: "0x" + "ee".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "33".repeat(32) },
      wireSession({ status: "complete", subscription: wireSub({ status: "active", started_at: T0, stream_address: "0x1" }) }),
      wireSession({ status: "complete", subscription: wireSub({ status: "paused", started_at: T0, paused_at: T0 + 30, stream_address: "0x1" }) }),
    ];
    const paused = await a.pause("cs_abc");
    expect(wallet.signMessage).toHaveBeenCalledWith("0x" + "ee".repeat(32));
    expect(calls.find((c) => c.url.endsWith("/pause/prepare"))?.method).toBe("POST");
    expect(calls.find((c) => c.url.endsWith("/pause"))?.body).toEqual({ signature: "0x" + "cd".repeat(65), deadline: String(T0 + 600) });
    expect(paused.subscription).toMatchObject({ status: "paused", pausedAt: (T0 + 30) * 1000 });

    calls = [];
    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "4", deadline: String(T0 + 700), message: "0x" + "ff".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "44".repeat(32) },
      wireSession({ status: "complete", subscription: wireSub({ status: "active", started_at: T0, stream_address: "0x1" }) }),
    ];
    const resumed = await a.resume("cs_abc");
    expect(calls.find((c) => c.url.endsWith("/resume"))?.body).toEqual({ signature: "0x" + "cd".repeat(65), deadline: String(T0 + 700) });
    expect(resumed.subscription).toMatchObject({ status: "active", pausedAt: null });
  });

  it("FR_CHK_031_getBalance_reads_the_balance_route_with_the_identity_token_and_maps_the_shape", async () => {
    const a = api();
    responses = [{ balance_usd: "3.10", needs_funding: true, receive_address: "0xabc", token: "AUSD", network: "Monad testnet", chain_id: 10143 }];
    const b = await a.getBalance("cs_abc");
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/v1/checkout/sessions/cs_abc/balance` });
    expect(calls[0]!.headers?.["x-privy-token"]).toBe("tok_fresh");
    expect(b).toEqual({ balanceUsd: "3.10", needsFunding: true, receiveAddress: "0xabc", token: "AUSD", network: "Monad testnet" });
  });

  it("FR_CHK_031_a_start_refused_for_funds_is_an_insufficient_funds_error_with_the_server_sentence", async () => {
    const a = api();
    await a.signIn("cs_abc", {});
    responses = [
      wireSession({ customer: { id: "cus_1", email: null }, subscription: wireSub({ max_duration_seconds: 3600 }) }),
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: {}, types: { Permit: [] }, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "1", deadline: String(T0 + 700) } } },
      { __status: 400, error: { type: "invalid_request_error", code: "insufficient_balance", message: "This meter needs $14.40 to start. Your balance is $3.10." } },
    ];
    await expect(a.start("cs_abc")).rejects.toMatchObject({ code: "insufficient_funds", message: "This meter needs $14.40 to start. Your balance is $3.10." });
  });

  it("FR_CHK_030_a_pause_rate_limit_reads_as_too_many_changes", async () => {
    responses = [{ __status: 429, error: { type: "rate_limit_error", code: "rate_limited", message: "Too many changes. Try again in a bit." } }];
    await expect(api().pause("cs_abc")).rejects.toMatchObject({ code: "rate_limited", message: "Too many changes. Try again in a bit." });
  });

  it("FR-CHK-027: a stale token is refreshed and the call retried once; a second 401 or a 403 means sign in again; 503 means not set up", async () => {
    const a = api();
    await a.signIn("cs_abc", {});
    const invalid = { __status: 401, error: { type: "authentication_error", code: "subscriber_auth_invalid", message: "Sign in again to continue." } };
    tokens = ["tok_stale", "tok_fresh"];
    responses = [invalid, { permit: {} }, wireSession({ subscription: wireSub() })];
    await a.setCap("cs_abc", 3600);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.headers?.["x-privy-token"])).toEqual(["tok_stale", "tok_fresh"]);
    expect(identityToken).toHaveBeenCalledTimes(2);

    calls = [];
    responses = [invalid, invalid];
    await expect(a.setCap("cs_abc", 3600)).rejects.toMatchObject({ code: "sign_in_required", message: "Sign in again." });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);

    calls = [];
    responses = [{ __status: 403, error: { type: "authentication_error", code: "subscriber_mismatch", message: "Signed in as a different subscriber." } }];
    await expect(a.setCap("cs_abc", 3600)).rejects.toMatchObject({ code: "sign_in_required" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

    responses = [{ __status: 503, error: { type: "api_error", code: "subscriber_auth_unconfigured", message: "set PRIVY_APP_ID" } }];
    await expect(a.setCap("cs_abc", 3600)).rejects.toMatchObject({ code: "unconfigured", message: "Checkout is not set up yet." });

    tokens = [null];
    await expect(a.setCap("cs_abc", 3600)).rejects.toMatchObject({ code: "sign_in_required" });
  });
});

describe("FR-CHK-034 held subscriptions from the wire", () => {
  it("FR_CHK_034_a_funded_unstarted_merchant_mode_subscription_carries_its_hold", () => {
    const s = mapSession(wireSession({ status: "complete", subscription: wireSub({ start_mode: "merchant", start_by: T0 + 900, funded_usd: "14.4", stream_address: "0x86776c5be46d01242285aac66040b3bf0634cd8a" }) }) as never);
    expect(s.subscription?.hold).toEqual({ startBy: (T0 + 900) * 1000, heldUsd: "14.4" });
  });

  it("FR_CHK_034_no_hold_in_checkout_mode_or_before_the_money_arrives", () => {
    expect(mapSession(wireSession({ subscription: wireSub({ start_mode: "checkout", start_by: null, funded_usd: "14.4" }) }) as never).subscription?.hold).toBeUndefined();
    // Prepared on a merchant-mode product but not yet funded: max_escrow_usd is set, funded_usd is not.
    expect(mapSession(wireSession({ subscription: wireSub({ start_mode: "merchant", start_by: T0 + 900, funded_usd: "0" }) }) as never).subscription?.hold).toBeUndefined();
  });
});

describe("FR-CHK-033 merchant-mode start does not wait for the meter", () => {
  it("FR_CHK_033_start_returns_once_the_authorisation_is_submitted_without_polling_for_active", async () => {
    const a = api();
    await a.signIn("cs_abc", {});
    const merchantSub = wireSub({ start_mode: "merchant", start_by: T0 + 900 });
    responses = [
      wireSession({ customer: { id: "cus_1", email: null }, subscription: merchantSub }),
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: {}, types: { Permit: [] }, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "0", deadline: String(T0 + 700) } } },
      { subscription: "sub_1", pending_tx: "0x" + "11".repeat(32) },
      wireSession({ customer: { id: "cus_1", email: null }, subscription: merchantSub }),
    ];
    calls = [];
    const s = await a.start("cs_abc");
    expect(calls.find((c) => c.url.endsWith("/start"))).toBeTruthy();
    // One read before signing, one after submitting: the merchant starts the meter, so there is nothing to wait for.
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
    expect(s.subscription).toMatchObject({ status: "incomplete", startMode: "merchant" });
  });
});

describe("FR-CHK-035 the product's start mode from the wire", () => {
  it("FR_CHK_035_maps_the_product_start_mode", () => {
    const merchant = mapSession(wireSession({ product: { id: "prod_1", name: "Lambda", rate_usd_per_second: "0.002", allow_pause: false, active: true, start_mode: "merchant" } }) as never);
    expect(merchant.product.startMode).toBe("merchant");
    expect(mapSession(wireSession() as never).product.startMode).toBeUndefined();
  });
});
