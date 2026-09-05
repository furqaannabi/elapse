import { sql } from "../src/db/client";
import { createMerchant } from "../src/db/merchants";
import { createApiKey } from "../src/db/api-keys";
import { app } from "../src/app";

/** Truncate every merchant-scoped table (cascades from merchants). */
export async function resetDb(): Promise<void> {
  await sql`TRUNCATE merchants CASCADE`;
}

export interface Fixture {
  merchantId: string;
  skTest: string;
  skLive: string;
  pkTest: string;
}

/** A merchant with one secret key per mode and a test publishable key, plaintexts returned for the test. */
export async function seedMerchant(email = `m-${Math.random().toString(36).slice(2)}@example.com`): Promise<Fixture> {
  const merchant = await createMerchant({ name: "Acme GPU", email });
  const skTest = await createApiKey({ merchantId: merchant.id, kind: "sk", livemode: false, name: "default", actor: "test" });
  const skLive = await createApiKey({ merchantId: merchant.id, kind: "sk", livemode: true, name: "default", actor: "test" });
  const pkTest = await createApiKey({ merchantId: merchant.id, kind: "pk", livemode: false, name: "default", actor: "test" });
  return { merchantId: merchant.id, skTest: skTest.plaintext, skLive: skLive.plaintext, pkTest: pkTest.plaintext };
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
