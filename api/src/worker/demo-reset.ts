/**
 * The demo configuration reset (FR-WRK-076, ADR 2026-10-02 demo account).
 *
 * Every six hours, and once when the worker starts, the demo merchant's test-mode configuration goes
 * back to the seed: every seed object — the demo's own and the hosted examples' Products, endpoints
 * and keys, found by `demo_seed_key` — restored, never archived, revoked or deleted; what a judge
 * made archived, deleted or revoked; a working publishable key in place.
 *
 * It never deletes or edits history — Subscriptions, Invoices, Customers, Events, the ledger and the
 * audit log stay, and so do the seed endpoint's Deliveries. (Deleting a judge's endpoint takes its
 * own Deliveries with it, as the dashboard's Delete always has.) It never touches live mode or any
 * other merchant, and without a demo merchant it does nothing.
 */
import { sql } from "../db/client";
import { findDemoMerchant } from "../db/demo";
import { restoreSeedConfiguration } from "../services/demo-catalog";
import { sleep } from "./sleep";

export const DEMO_RESET_MS = Number(process.env.DEMO_RESET_MS ?? 21_600_000);

export async function resetDemo(log: (e: Record<string, unknown>) => void = console.error): Promise<boolean> {
  const demo = await findDemoMerchant();
  if (!demo) return false;
  const id = demo.id;
  // What judges made: archived, deleted, revoked. Seed objects (a non-null demo_seed_key) are never touched here.
  await sql`UPDATE products SET active = false WHERE merchant_id = ${id} AND NOT livemode AND demo_seed_key IS NULL AND active`;
  await sql`DELETE FROM webhook_endpoints WHERE merchant_id = ${id} AND NOT livemode AND demo_seed_key IS NULL`;
  await sql`UPDATE api_keys SET revoked_at = now() WHERE merchant_id = ${id} AND NOT livemode AND demo_seed_key IS NULL AND revoked_at IS NULL`;
  // What the seed made: put back as it was.
  const { examplesMissingKeys } = await restoreSeedConfiguration(id);
  if (examplesMissingKeys.length > 0) {
    log({ msg: "demo examples have no key; run demo:seed --reissue-examples and update their .env", examples: examplesMissingKeys });
  }
  return true;
}

/** Runs the reset now and then every `everyMs`, each in its own try/catch so a failure never ends the loop. */
export async function demoResetForever(
  signal?: AbortSignal,
  log: (e: Record<string, unknown>) => void = console.error,
  everyMs = DEMO_RESET_MS,
  reset: () => Promise<unknown> = () => resetDemo(log),
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
