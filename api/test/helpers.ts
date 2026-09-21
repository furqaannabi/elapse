import { sql } from "../src/db/client";
import { createMerchant, setPayoutAddress } from "../src/db/merchants";
import { createApiKey } from "../src/db/api-keys";
import { app } from "../src/app";

// Note for test authors: Bun 1.4's `toMatchObject` with asymmetric matchers (expect.any …) mutates the
// received object. Clone first (`structuredClone(body)`) if you read the object again afterwards.

/** Truncate every merchant-scoped table (cascades from merchants) and the unscoped samples. */
export async function resetDb(): Promise<void> {
  // A CLI stream loop cancelled by the previous test can still be mid-SELECT: it notices the
  // cancellation only on its next poll. TRUNCATE wants AccessExclusiveLock, that SELECT holds
  // AccessShare, and Postgres calls it a deadlock after deadlock_timeout (1 s) — which is why the
  // flake always cost almost exactly 1000 ms and always landed on whichever test ran after a
  // streaming one. Retrying is enough: by the time we are back, the loop has seen the cancel.
  for (let attempt = 0; ; attempt++) {
    try {
      await sql`TRUNCATE merchants CASCADE`;
      await sql`TRUNCATE relayer_balance_samples`;
      return;
    } catch (e) {
      if (attempt >= 2 || (e as { errno?: string }).errno !== "40P01") throw e;
    }
  }
}

export interface Fixture {
  merchantId: string;
  skTest: string;
  skLive: string;
  pkTest: string;
  pkLive: string;
  /** Where streams pay this merchant; a fixed test address. */
  payoutAddress: string;
}

export const TEST_PAYOUT_ADDRESS = "0x1111111111111111111111111111111111111111";

/** A merchant with one secret key per mode and a test publishable key, plaintexts returned for the test. */
export async function seedMerchant(email = `m-${Math.random().toString(36).slice(2)}@example.com`): Promise<Fixture> {
  const merchant = await createMerchant({ name: "Acme GPU", email });
  const skTest = await createApiKey({ merchantId: merchant.id, kind: "sk", livemode: false, name: "default", actor: "test" });
  const skLive = await createApiKey({ merchantId: merchant.id, kind: "sk", livemode: true, name: "default", actor: "test" });
  const pkTest = await createApiKey({ merchantId: merchant.id, kind: "pk", livemode: false, name: "default", actor: "test" });
  const pkLive = await createApiKey({ merchantId: merchant.id, kind: "pk", livemode: true, name: "default", actor: "test" });
  await setPayoutAddress(merchant.id, TEST_PAYOUT_ADDRESS);
  return { merchantId: merchant.id, skTest: skTest.plaintext, skLive: skLive.plaintext, pkTest: pkTest.plaintext, pkLive: pkLive.plaintext, payoutAddress: TEST_PAYOUT_ADDRESS };
}

/** JSON request against the in-process app; no port, no network. */
export async function api(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await app.request(path, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
