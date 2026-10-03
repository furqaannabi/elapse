/**
 * Everything the demo seed makes, by name (FR-API-154/156, FR-WRK-076; ADR 2026-10-02 demo account,
 * ADR 2026-10-02 examples on the demo merchant).
 *
 * Each object carries a `demo_seed_key` — never matched by name or rate, which a judge's object or
 * an example's can share — and a non-null key is what protects it from demo-session writes
 * (FR-API-153). `ensure*` finds or creates; `restoreSeedConfiguration` puts every seed object back
 * the way the seed made it, for the six-hourly reset. Nothing here touches history.
 */
import { config } from "../config";
import { sql } from "../db/client";
import { createApiKey } from "../db/api-keys";
import { insertProduct } from "../db/products";
import { insertWebhookEndpoint, rollWebhookSecret } from "../db/webhook-endpoints";
import { decimalToBaseUnits } from "../lib/money";

type SeedProduct = { key: string; name: string; rate: string; allowPause: boolean; startMode: "checkout" | "merchant"; storefrontName: string | null };

/** The demo's own products, and the hosted examples' — matching each example's `boot.ts` so it finds rather than makes its Product. */
export const SEED_PRODUCTS = {
  gpu: { key: "product:gpu", name: "GPU time", rate: "0.004", allowPause: false, startMode: "checkout", storefrontName: null },
  inference: { key: "product:inference", name: "Inference API", rate: "0.0005", allowPause: false, startMode: "checkout", storefrontName: null },
  saas: { key: "product:saas", name: "GPU · 4090", rate: "0.004", allowPause: true, startMode: "checkout", storefrontName: "Acme GPU" },
  lambda: { key: "product:lambda", name: "Serverless runtime", rate: "0.002", allowPause: true, startMode: "merchant", storefrontName: "Northwind Compute" },
} as const satisfies Record<string, SeedProduct>;
export type SeedProductName = keyof typeof SEED_PRODUCTS;

/** The hosted examples (FR-EXM-039, FR-EXM-161). */
export const EXAMPLES = ["saas", "lambda"] as const;
export type Example = (typeof EXAMPLES)[number];

/** Where the hosted examples live; their webhook endpoints deliver to `/{example}/webhooks` here. */
export const examplesOrigin = () => (process.env.DEMO_EXAMPLES_ORIGIN ?? "https://examples.elapse.finance").replace(/\/+$/, "");
/** The URL the demo's own endpoint delivers to: the API's sink (FR-API-155). */
export const demoSinkUrl = () => `${config.publicApiUrl}/v1/demo/webhooks`;

const SEED_ENDPOINTS: Record<string, () => string> = {
  "endpoint:sink": demoSinkUrl,
  "endpoint:saas": () => `${examplesOrigin()}/saas/webhooks`,
  "endpoint:lambda": () => `${examplesOrigin()}/lambda/webhooks`,
};

const entries = <K extends string, V>(o: Record<K, V>) => Object.entries(o) as Array<[K, V]>;

/** Finds or creates every seed Product; returns their ids by name. */
export async function ensureSeedProducts(merchantId: string): Promise<Record<SeedProductName, string>> {
  const out = {} as Record<SeedProductName, string>;
  for (const [name, p] of entries<SeedProductName, SeedProduct>(SEED_PRODUCTS)) {
    const [found] = await sql`SELECT id FROM products WHERE merchant_id = ${merchantId} AND demo_seed_key = ${p.key}`;
    if (found) {
      out[name] = found.id;
      continue;
    }
    const row = await insertProduct({
      merchantId, livemode: false, name: p.name, description: null, rateUsdPerSecond: p.rate,
      ratePerSecondWei: decimalToBaseUnits(p.rate, config.tokenDecimals)!, // the seed rates are fixed decimal strings
      allowPause: p.allowPause, startMode: p.startMode,
    });
    await sql`UPDATE products SET demo_seed = true, demo_seed_key = ${p.key}, storefront_name = ${p.storefrontName} WHERE id = ${row.id}`;
    out[name] = row.id;
  }
  return out;
}

/** Finds or creates every seed endpoint. Returns the signing secret of each one it created, by seed key. */
export async function ensureSeedEndpoints(merchantId: string): Promise<Record<string, string>> {
  const created: Record<string, string> = {};
  for (const [key, url] of Object.entries(SEED_ENDPOINTS)) {
    const [found] = await sql`SELECT id FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND demo_seed_key = ${key}`;
    if (found) continue;
    const ep = await insertWebhookEndpoint({ merchantId, livemode: false, url: url(), events: ["*"], actor: "demo_seed" });
    await sql`UPDATE webhook_endpoints SET demo_seed = true, demo_seed_key = ${key} WHERE id = ${ep.row.id}`;
    created[key] = ep.secret;
  }
  return created;
}

/** What one hosted example's `.env` needs from the seed. Only values minted by this run are present. */
export interface ExampleCredentials {
  example: Example;
  secretKey?: string;
  webhookSecret?: string;
}

/**
 * Each example's test secret key and its endpoint's signing secret. Minted when missing; left alone
 * when present, since their only copy lives in the example's `.env` — unless `reissue`, which revokes
 * and replaces the key and rolls the endpoint's secret with no grace.
 */
export async function ensureExampleCredentials(merchantId: string, opts: { reissue?: boolean; endpointSecrets?: Record<string, string> } = {}): Promise<ExampleCredentials[]> {
  const out: ExampleCredentials[] = [];
  for (const example of EXAMPLES) {
    const creds: ExampleCredentials = { example };
    const keyName = `key:${example}`;
    const [live] = await sql`SELECT id FROM api_keys WHERE merchant_id = ${merchantId} AND demo_seed_key = ${keyName}
                             AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
    if (!live || opts.reissue) {
      // The old row stays for the audit trail, revoked and no longer a seed object.
      await sql`UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()), demo_seed_key = NULL WHERE merchant_id = ${merchantId} AND demo_seed_key = ${keyName}`;
      const key = await createApiKey({ merchantId, kind: "sk", livemode: false, name: `examples/${example}`, actor: "demo_seed" });
      await sql`UPDATE api_keys SET demo_seed = true, demo_seed_key = ${keyName} WHERE id = ${key.row.id}`;
      creds.secretKey = key.plaintext;
    }
    const endpointKey = `endpoint:${example}`;
    if (opts.endpointSecrets?.[endpointKey]) {
      creds.webhookSecret = opts.endpointSecrets[endpointKey];
    } else if (opts.reissue) {
      const [ep] = await sql`SELECT id FROM webhook_endpoints WHERE merchant_id = ${merchantId} AND demo_seed_key = ${endpointKey}`;
      const rolled = ep ? await rollWebhookSecret(merchantId, false, ep.id, 0, "demo_seed") : null;
      if (rolled) creds.webhookSecret = rolled.secret;
    }
    out.push(creds);
  }
  return out;
}

/**
 * The reset's half of the catalogue (FR-WRK-076): every seed object back as the seed made it, and
 * recreated if missing — except an example's key, whose secret only the example holds. Returns the
 * examples whose key is missing, so the caller can say `demo:seed --reissue-examples` is needed.
 */
export async function restoreSeedConfiguration(merchantId: string): Promise<{ examplesMissingKeys: Example[] }> {
  const ids = await ensureSeedProducts(merchantId);
  for (const [name, p] of entries<SeedProductName, SeedProduct>(SEED_PRODUCTS)) {
    await sql`UPDATE products SET name = ${p.name}, description = NULL, allow_pause = ${p.allowPause}, start_mode = ${p.startMode},
              storefront_name = ${p.storefrontName}, active = true WHERE id = ${ids[name]}`;
  }
  await ensureSeedEndpoints(merchantId);
  for (const [key, url] of Object.entries(SEED_ENDPOINTS)) {
    await sql`UPDATE webhook_endpoints SET url = ${url()}, events = ARRAY['*']::text[], disabled = false WHERE merchant_id = ${merchantId} AND demo_seed_key = ${key}`;
  }
  const [pk] = await sql`SELECT 1 FROM api_keys WHERE merchant_id = ${merchantId} AND demo_seed_key = 'key:pk' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
  if (!pk) {
    await sql`UPDATE api_keys SET demo_seed_key = NULL WHERE merchant_id = ${merchantId} AND demo_seed_key = 'key:pk'`;
    const key = await createApiKey({ merchantId, kind: "pk", livemode: false, name: "default", actor: "demo_reset" });
    await sql`UPDATE api_keys SET demo_seed = true, demo_seed_key = 'key:pk' WHERE id = ${key.row.id}`;
  }
  const examplesMissingKeys: Example[] = [];
  for (const example of EXAMPLES) {
    const [live] = await sql`SELECT 1 FROM api_keys WHERE merchant_id = ${merchantId} AND demo_seed_key = ${`key:${example}`}
                             AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
    if (!live) examplesMissingKeys.push(example);
  }
  return { examplesMissingKeys };
}

/** The demo merchant's test publishable key, for the examples' `.env` (a publishable key is not a secret). */
export async function demoPublishableKey(merchantId: string): Promise<string | null> {
  const [row] = await sql`SELECT plaintext FROM api_keys WHERE merchant_id = ${merchantId} AND demo_seed_key = 'key:pk' AND revoked_at IS NULL`;
  return (row?.plaintext as string | undefined) ?? null;
}
