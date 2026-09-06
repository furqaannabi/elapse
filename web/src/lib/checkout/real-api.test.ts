import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealCheckoutApi, mapSession, type SubscriberWallet } from "./real-api";
import { CheckoutApiError } from "./mock-api";

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

let calls: Array<{ method: string; url: string; body?: unknown }>;
let responses: Array<unknown | ((c: { url: string; body?: unknown }) => unknown)>;
const wallet: SubscriberWallet = {
  address: "0x2222222222222222222222222222222222222222",
  signTypedData: vi.fn(async () => ("0x" + "ab".repeat(65)) as `0x${string}`),
  signMessage: vi.fn(async () => ("0x" + "cd".repeat(65)) as `0x${string}`),
};

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body });
    const next = responses.shift() ?? wireSession();
    const payload = typeof next === "function" ? (next as (c: { url: string; body?: unknown }) => unknown)({ url: String(url), body }) : next;
    const status = (payload as { __status?: number }).__status ?? 200;
    return new Response(JSON.stringify(payload), { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const api = () => createRealCheckoutApi({ baseUrl: BASE, wallet: () => wallet, sleep: async () => {} });

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
    await a.signIn("cs_abc", { email: "a@b.c" });
    responses = [
      { customer: "cus_1", subscription: "sub_1", chain_id: 10143, max_duration_seconds: 3600, max_escrow_usd: "14.4", permit: { domain: {}, types: {}, primaryType: "Permit", message: { owner: wallet.address, spender: "0xf", value: "14400000", nonce: "0", deadline: String(T0 + 600) } } },
      wireSession({ customer: { id: "cus_1", email: "a@b.c" }, subscription: wireSub() }),
    ];
    const s = await a.setCap("cs_abc", 3600);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: `${BASE}/v1/checkout/sessions/cs_abc/prepare`, body: { max_duration_seconds: 3600, wallet_address: wallet.address, email: "a@b.c" } });
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

  it("API errors carry the server message and pause is not offered", async () => {
    responses = [{ __status: 409, error: { type: "invalid_request_error", code: "already_started", message: "This session has already started." } }];
    await expect(api().start("cs_abc")).rejects.toMatchObject({ code: "invalid_state", message: "This session has already started." });
    await expect(api().pause("cs_abc")).rejects.toBeInstanceOf(CheckoutApiError);
  });
});
