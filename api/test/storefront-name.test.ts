/**
 * FR-API-156: the storefront name (ADR 2026-10-02 examples on the demo merchant). A Product the seed
 * gave a storefront name is what the subscriber sees as the merchant — in the Elapse window, the
 * account page and the receipt email — while no request or response schema carries the field.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, resetDb, seedMerchant, type Fixture } from "./helpers";
import { sql } from "../src/db/client";
import { setChainClient } from "../src/chain/relayer";
import { listAccountSubscriptions, serializeAccountSubscription } from "../src/db/account";
import { receiptEmail } from "../src/routes/account";
import { fakeChain } from "./fake-chain";
import { privyFixture } from "./privy-fixture";

let m: Fixture;
let privy: Awaited<ReturnType<typeof privyFixture>>;
const subscriber = privateKeyToAccount(generatePrivateKey());

async function session(storefront: string | null) {
  const p = await api("POST", "/v1/products", { key: m.skTest, body: { name: "GPU · 4090", rate_usd_per_second: "0.004" } });
  if (storefront) await sql`UPDATE products SET storefront_name = ${storefront} WHERE id = ${p.body.id}`;
  const s = await api("POST", "/v1/checkout/sessions", { key: m.skTest, body: { product: p.body.id, success_url: "https://x.test/ok", cancel_url: "https://x.test/no" } });
  return { productId: p.body.id as string, sessionId: s.body.id as string, created: s.body };
}

beforeEach(async () => {
  await resetDb();
  m = await seedMerchant(); // named "Acme GPU" by the helper — rename so the two names differ
  await sql`UPDATE merchants SET name = 'Acme Cloud (demo)' WHERE id = ${m.merchantId}`;
  setChainClient(fakeChain().client);
  privy = await privyFixture();
  privy.use();
});
afterEach(() => {
  setChainClient(null);
  privy.off();
});

describe("FR-API-156 storefront name", () => {
  it("FR_API_156_the_session_names_the_storefront_when_its_product_has_one", async () => {
    const { sessionId } = await session("Northwind Compute");
    const r = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(r.body.merchant.name).toBe("Northwind Compute");
  });

  it("FR_API_156_without_one_the_merchant_name_is_unchanged", async () => {
    const { sessionId } = await session(null);
    const r = await api("GET", `/v1/checkout/sessions/${sessionId}`, { key: m.pkTest });
    expect(r.body.merchant.name).toBe("Acme Cloud (demo)");
  });

  it("FR_API_156_the_account_page_and_receipt_follow", async () => {
    const { sessionId } = await session("Acme GPU");
    const prep = await api("POST", `/v1/checkout/sessions/${sessionId}/prepare`, { key: m.pkTest, body: { max_duration_seconds: 3600 }, headers: { "x-privy-token": await privy.token(subscriber.address, { email: "sub@example.com" }) } });
    await sql`UPDATE subscriptions SET status = 'canceled', started_at = now() - interval '83 seconds', canceled_at = now(), settled_seconds = 83 WHERE id = ${prep.body.subscription}`;
    const [row] = await listAccountSubscriptions(subscriber.address.toLowerCase(), ["canceled"]);
    const shown = serializeAccountSubscription(row!);
    expect(shown.merchant.name).toBe("Acme GPU");
    expect(receiptEmail(shown).text).toContain("Acme GPU");
    expect(receiptEmail(shown).text).not.toContain("Acme Cloud");
  });

  it("FR_API_156_no_response_carries_the_field", async () => {
    const { productId } = await session("Acme GPU");
    const p = await api("GET", `/v1/products/${productId}`, { key: m.skTest });
    expect(JSON.stringify(p.body)).not.toContain("storefront");
    expect(p.body.name).toBe("GPU · 4090");
  });
});
