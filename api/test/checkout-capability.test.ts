import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { setChainClient } from "../src/chain/relayer";
import { fakeChain } from "./fake-chain";
import { streamCreated, deposited, streamStarted } from "./ingest-fixtures";
import { app } from "../src/app";

/** Decided 2026-09-05 (William, option a): the hosted page sends no key; the session id is the pass, from the checkout origin only. */
const ORIGIN = "http://localhost:3000";
const page = (method: string, path: string, body?: unknown) => api(method, path, { body, headers: { origin: ORIGIN } });

let m: Fixture;
let chain: ReturnType<typeof fakeChain>;
const subscriber = privateKeyToAccount(generatePrivateKey());

async function newSession() {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU", rate_usd_per_second: "0.004" } });
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  return s.body.id as string;
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant();
  chain = fakeChain();
  setChainClient(chain.client);
});
afterEach(() => setChainClient(null));

describe("hosted checkout capability auth", () => {
  it("the page reads and drives a session with no key from the checkout origin", async () => {
    const id = await newSession();
    const get = await page("GET", `/v1/checkout/sessions/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.customer).toBeNull(); // public projection, not the sk_ object
    expect(get.body).not.toHaveProperty("url");
    const prep = await page("POST", `/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: 600, wallet_address: subscriber.address });
    expect(prep.status).toBe(200);
    const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
    const start = await page("POST", `/v1/checkout/sessions/${id}/start`, { signature });
    expect(start.status).toBe(202);
  });

  it("no key and a foreign or missing origin is 401", async () => {
    const id = await newSession();
    expect((await api("GET", `/v1/checkout/sessions/${id}`)).status).toBe(401);
    expect((await api("GET", `/v1/checkout/sessions/${id}`, { headers: { origin: "https://evil.example" } })).status).toBe(401);
    expect((await api("POST", `/v1/checkout/sessions/${id}/prepare`, { body: { max_duration_seconds: 600, wallet_address: subscriber.address }, headers: { origin: "https://evil.example" } })).status).toBe(401);
  });

  it("an unknown session id is 404 and merchant routes stay closed to the page", async () => {
    expect((await page("GET", "/v1/checkout/sessions/cs_nope")).status).toBe(404);
    expect((await page("GET", "/v1/products")).status).toBe(401);
    expect((await page("POST", "/v1/checkout/sessions", { product: "prod_x", success_url: "https://x.test/ok", cancel_url: "https://x.test/no" })).status).toBe(401);
    expect((await page("GET", "/v1/subscriptions")).status).toBe(401);
  });

  it("CORS preflight from the checkout origin is answered; other origins are not", async () => {
    const ok = await app.request("/v1/checkout/sessions/cs_x/prepare", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
    const bad = await app.request("/v1/checkout/sessions/cs_x/prepare", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const status = await app.request("/v1/status", { headers: { origin: ORIGIN } });
    expect(status.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("judge mode reads the session's delivery log without a key and without endpoint URLs", async () => {
    const id = await newSession();
    await api("POST", "/v1/webhook_endpoints", { key: m.skTest, body: { url: "https://merchant.example/secret-path", events: ["*"] } });
    const prep = await page("POST", `/v1/checkout/sessions/${id}/prepare`, { max_duration_seconds: 600, wallet_address: subscriber.address });
    const signature = await subscriber.signTypedData({ domain: prep.body.permit.domain, types: prep.body.permit.types, primaryType: "Permit", message: { owner: prep.body.permit.message.owner, spender: prep.body.permit.message.spender, value: BigInt(prep.body.permit.message.value), nonce: 0n, deadline: BigInt(prep.body.permit.message.deadline) } });
    const start = await page("POST", `/v1/checkout/sessions/${id}/start`, { signature });
    const tx: string = start.body.pending_tx;
    const H = { authorization: "Bearer ingest-test-token" };
    await api("POST", "/internal/ingest", { headers: H, body: streamCreated(tx) });
    await api("POST", "/internal/ingest", { headers: H, body: deposited(tx) });
    await api("POST", "/internal/ingest", { headers: H, body: streamStarted(tx) });
    const log = await page("GET", `/v1/checkout/sessions/${id}/deliveries`);
    expect(log.status).toBe(200);
    expect(log.body.data.map((d: any) => d.type).sort()).toEqual(["checkout.session.completed", "subscription.created"]);
    expect(log.body.data[0]).toMatchObject({ id: expect.stringMatching(/^evt_/), status: null, attempt: 0, at: expect.any(Number) });
    expect(JSON.stringify(log.body)).not.toContain("merchant.example");
  });
});
