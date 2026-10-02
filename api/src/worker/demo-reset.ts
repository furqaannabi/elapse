/**
 * The demo configuration reset (FR-WRK-076, ADR 2026-10-02 demo account).
 *
 * Every six hours, and once when the worker starts, the demo merchant's test-mode configuration goes
 * back to the seed: seed products present, unarchived, at their seed name; products a judge made
 * archived; endpoints a judge made deleted; the seed endpoint present, enabled, delivering every
 * event to the sink; keys a judge made revoked, and a working publishable key in place.
 *
 * It never deletes or edits history — Subscriptions, Invoices, Customers, Events, the ledger and the
 * audit log stay, and so do the seed endpoint's Deliveries. (Deleting a judge's endpoint takes its
 * own Deliveries with it, as the dashboard's Delete always has.) It never touches live mode or any
 * other merchant, and without a demo merchant it does nothing.
 */
import { sql } from "../db/client";
import { createApiKey } from "../db/api-keys";
import { findDemoMerchant } from "../db/demo";
import { demoSinkUrl, ensureSeedEndpoint, ensureSeedProducts, SEED_PRODUCTS } from "../services/demo-seed";
import { sleep } from "./sleep";

export const DEMO_RESET_MS = Number(process.env.DEMO_RESET_MS ?? 21_600_000);

export async function resetDemo(): Promise<boolean> {
  const demo = await findDemoMerchant();
  if (!demo) return false;
  const id = demo.id;

  const seeds = await ensureSeedProducts(id);
  for (const [key, p] of Object.entries(SEED_PRODUCTS) as Array<[keyof typeof SEED_PRODUCTS, (typeof SEED_PRODUCTS)[keyof typeof SEED_PRODUCTS]]>) {
    await sql`UPDATE products SET name = ${p.name}, description = NULL, allow_pause = false, active = true WHERE id = ${seeds[key]}`;
  }
  await sql`UPDATE products SET active = false WHERE merchant_id = ${id} AND NOT livemode AND NOT demo_seed AND active`;

  await sql`DELETE FROM webhook_endpoints WHERE merchant_id = ${id} AND NOT livemode AND NOT demo_seed`;
  await ensureSeedEndpoint(id);
  await sql`UPDATE webhook_endpoints SET url = ${demoSinkUrl()}, events = ARRAY['*']::text[], disabled = false
            WHERE merchant_id = ${id} AND NOT livemode AND demo_seed`;

  await sql`UPDATE api_keys SET revoked_at = now() WHERE merchant_id = ${id} AND NOT livemode AND NOT demo_seed AND revoked_at IS NULL`;
  const [pk] = await sql`SELECT 1 FROM api_keys WHERE merchant_id = ${id} AND NOT livemode AND kind = 'pk' AND demo_seed
                         AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
  if (!pk) {
    const key = await createApiKey({ merchantId: id, kind: "pk", livemode: false, name: "default", actor: "demo_reset" });
    await sql`UPDATE api_keys SET demo_seed = true WHERE id = ${key.row.id}`;
  }
  return true;
}

/** Runs the reset now and then every `everyMs`, each in its own try/catch so a failure never ends the loop. */
export async function demoResetForever(
  signal?: AbortSignal,
  log: (e: Record<string, unknown>) => void = console.error,
  everyMs = DEMO_RESET_MS,
  reset: () => Promise<unknown> = resetDemo,
): Promise<void> {
  while (!signal?.aborted) {
    try {
      if (await reset()) log({ msg: "demo configuration reset" });
    } catch (e) {
      console.error("demo reset failed", { message: (e as Error).message });
    }
    await sleep(everyMs, signal);
  }
}
