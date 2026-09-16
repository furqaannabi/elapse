import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealAccountApi } from "./real-api";
import type { SubscriberWallet } from "@/lib/checkout/real-api";

const BASE = "http://api.test";
const T0 = 1_757_000_000;
const row = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", object: "subscription", status: "active", livemode: false,
  merchant: { name: "Nimbus", logo_url: null, support_url: "https://nimbus.example/help" },
  product: { name: "GPU · 4090", rate_usd_per_second: "0.004", allow_pause: false },
  started_at: T0, paused_at: null, canceled_at: null, ended_reason: null, max_duration_seconds: 3600,
  funded_usd: "14.4", settled_usd: "0", refunded_usd: "0", seconds_elapsed: 10,
  ...over,
});

let calls: Array<{ method: string; url: string; body?: unknown; headers: Record<string, string> }>;
let responses: unknown[];
let token: string | null;
const wallet: SubscriberWallet = { address: "0x2222222222222222222222222222222222222222", signTypedData: vi.fn(), signMessage: vi.fn(async () => ("0x" + "cd".repeat(65)) as `0x${string}`) };
const api = () => createRealAccountApi({ baseUrl: BASE, wallet: () => wallet, identityToken: async () => token, sleep: async () => {} });

beforeEach(() => {
  calls = [];
  responses = [];
  token = "tok";
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    const next = (responses.shift() ?? { object: "list", data: [] }) as { __status?: number };
    return new Response(JSON.stringify(next), { status: next.__status ?? 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("real account api", () => {
  it("FR_CHK_018_getView_is_signed_out_without_a_token_and_maps_running_meters_and_receipts_with_the_token", async () => {
    token = null;
    expect(await api().getView()).toEqual({ status: "signed_out" });
    expect(calls).toHaveLength(0);
    token = "tok";
    responses = [{ object: "list", data: [
      row(),
      row({ id: "sub_2", status: "paused", paused_at: T0 + 30, livemode: true, merchant: { name: "Halcyon", logo_url: "https://api.test/logo", support_url: null } }),
      row({ id: "sub_3", status: "canceled", canceled_at: T0 + 220, ended_reason: "canceled", settled_usd: "0.88", refunded_usd: "13.52", seconds_elapsed: 220, checkout_session: "cs_3", restarted_as: "cs_4" }),
    ] }];
    const v = await api().getView();
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/v1/account/subscriptions` });
    expect(calls[0]!.headers["x-privy-token"]).toBe("tok");
    if (v.status !== "signed_in") throw new Error("expected signed_in");
    expect(v.meters).toEqual([
      { subscription: "sub_1", test: true, merchant: { name: "Nimbus", supportUrl: "https://nimbus.example/help" }, product: { name: "GPU · 4090", rateUsdPerSecond: "0.004" }, status: "active", startedAt: T0 * 1000, pausedAt: null, maxDurationSeconds: 3600, fundedUsd: "14.4" },
      { subscription: "sub_2", test: false, merchant: { name: "Halcyon", logoUrl: "https://api.test/logo" }, product: { name: "GPU · 4090", rateUsdPerSecond: "0.004" }, status: "paused", startedAt: T0 * 1000, pausedAt: (T0 + 30) * 1000, maxDurationSeconds: 3600, fundedUsd: "14.4" },
    ]);
    expect(v.receipts).toEqual([
      { subscription: "sub_3", session: "cs_3", restartedAs: "cs_4", test: true, merchant: { name: "Nimbus", supportUrl: "https://nimbus.example/help" }, product: { name: "GPU · 4090", rateUsdPerSecond: "0.004" }, seconds: 220, amountSettledUsd: "0.88", refundedUsd: "13.52", startedAt: T0 * 1000, settledAt: (T0 + 220) * 1000, endedReason: "canceled", maxDurationSeconds: 3600 },
    ]);
    // never a wallet or chain word on the shapes
    expect(JSON.stringify(v)).not.toMatch(/0x|wallet|chain|stream/);
  });

  it("FR_CHK_019_cancel_prepares_signs_posts_then_polls_the_list_until_canceled_and_returns_the_receipt", async () => {
    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "0", deadline: String(T0 + 600), message: "0x" + "ee".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "22".repeat(32) },
      { object: "list", data: [row()] },
      { object: "list", data: [row({ status: "canceled", canceled_at: T0 + 83, ended_reason: "canceled", settled_usd: "0.332", refunded_usd: "14.068", seconds_elapsed: 83 })] },
    ];
    const r = await api().cancel("sub_1");
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_1/cancel/prepare` });
    expect(wallet.signMessage).toHaveBeenCalledWith("0x" + "ee".repeat(32));
    expect(calls[1]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_1/cancel`, body: { signature: "0x" + "cd".repeat(65), deadline: String(T0 + 600) } });
    expect(calls[1]!.headers["x-privy-token"]).toBe("tok");
    expect(r.receipt).toMatchObject({ subscription: "sub_1", seconds: 83, amountSettledUsd: "0.332", refundedUsd: "14.068", endedReason: "canceled" });
    expect(r.view.status).toBe("signed_in");
  });

  it("FR_CHK_029_emailReceipt_posts_to_the_receipt_route_and_maps_the_limit", async () => {
    responses = [{ sent: true }];
    expect(await api().emailReceipt("sub_3")).toEqual({ sent: true });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_3/receipt/email` });
    responses = [{ __status: 429, error: { type: "rate_limit_error", code: "receipt_already_sent", message: "Already sent. Check your inbox." } }];
    await expect(api().emailReceipt("sub_3")).rejects.toMatchObject({ code: "already_sent" });
  });

  it("FR_CHK_016_a_401_on_the_list_reads_as_signed_out_and_signIn_re_reads_the_view", async () => {
    responses = [{ __status: 401, error: { type: "authentication_error", code: "subscriber_auth_invalid", message: "Sign in again to continue." } }];
    expect(await api().getView()).toEqual({ status: "signed_out" });
    responses = [{ object: "list", data: [row()] }];
    const v = await api().signIn();
    expect(v.status).toBe("signed_in");
  });

  it("FR_CHK_020_startAgain_posts_to_the_sessions_again_route_and_returns_the_new_url", async () => {
    responses = [{ id: "cs_new", url: "http://localhost:3000/c/cs_new" }];
    expect(await api().startAgain("cs_3")).toEqual({ url: "http://localhost:3000/c/cs_new" });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/checkout/sessions/cs_3/again` });
    expect(calls[0]!.headers["x-privy-token"]).toBe("tok");
  });

  it("FR_CHK_030_meters_carry_allowPause_and_pause_then_resume_relay_through_the_account_routes_and_poll_the_list", async () => {
    responses = [{ object: "list", data: [row({ product: { name: "GPU · 4090", rate_usd_per_second: "0.004", allow_pause: true } })] }];
    const v = await api().getView();
    expect(v.status === "signed_in" && v.meters[0]).toMatchObject({ subscription: "sub_1", allowPause: true });

    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "1", deadline: String(T0 + 600), message: "0x" + "ee".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "33".repeat(32) },
      { object: "list", data: [row()] },
      { object: "list", data: [row({ status: "paused", paused_at: T0 + 30 })] },
    ];
    calls = [];
    const paused = await api().pause("sub_1");
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_1/pause/prepare` });
    expect(calls[1]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_1/pause`, body: { signature: "0x" + "cd".repeat(65), deadline: String(T0 + 600) } });
    expect(paused.status === "signed_in" && paused.meters[0]).toMatchObject({ subscription: "sub_1", status: "paused", pausedAt: (T0 + 30) * 1000 });

    responses = [
      { subscription: "sub_1", stream_address: "0x1", chain_id: 10143, nonce: "2", deadline: String(T0 + 700), message: "0x" + "ff".repeat(32) },
      { subscription: "sub_1", pending_tx: "0x" + "44".repeat(32) },
      { object: "list", data: [row()] },
    ];
    calls = [];
    const resumed = await api().resume("sub_1");
    expect(calls[1]).toMatchObject({ method: "POST", url: `${BASE}/v1/account/subscriptions/sub_1/resume` });
    expect(resumed.status === "signed_in" && resumed.meters[0]).toMatchObject({ status: "active", pausedAt: null });
  });

  it("FR_CHK_030_a_pause_rate_limit_reads_as_too_many_changes", async () => {
    responses = [{ __status: 429, error: { type: "rate_limit_error", code: "rate_limited", message: "Too many changes. Try again in a bit." } }];
    await expect(api().pause("sub_1")).rejects.toMatchObject({ code: "rate_limited", message: "Too many changes. Try again in a bit." });
  });
});

import { viewFrom, type WireAccountSubscription } from "./real-api";

describe("FR-CHK-036 held money on /account", () => {
  const T = 1_757_000_000;
  const row = (over: Partial<WireAccountSubscription>): WireAccountSubscription => ({
    id: "sub_held", status: "incomplete", livemode: false, checkout_session: "cs_held", restarted_as: null,
    merchant: { name: "Northwind Compute", logo_url: null, support_url: null },
    product: { name: "Serverless runtime", rate_usd_per_second: "0.002", allow_pause: false },
    started_at: null, paused_at: null, canceled_at: null, ended_reason: null,
    max_duration_seconds: 3600, funded_usd: "7.2", settled_usd: "0", refunded_usd: "0", seconds_elapsed: 0,
    start_mode: "merchant", start_by: T + 900,
    ...over,
  });

  it("FR_CHK_036_an_unstarted_merchant_row_is_held_money_not_a_meter_or_a_receipt", () => {
    const v = viewFrom([row({}), row({ id: "sub_run", status: "active", started_at: T, start_mode: "checkout", start_by: null })]);
    if (v.status !== "signed_in") throw new Error("expected signed in");
    expect(v.held).toEqual([
      { subscription: "sub_held", test: true, merchant: { name: "Northwind Compute" }, product: { name: "Serverless runtime" }, heldUsd: "7.2", startBy: (T + 900) * 1000 },
    ]);
    expect(v.meters.map((m) => m.subscription)).toEqual(["sub_run"]);
    expect(v.receipts).toEqual([]);
  });
});
