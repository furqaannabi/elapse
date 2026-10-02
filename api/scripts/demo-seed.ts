/**
 * `bun run demo:seed` — give the demo account (FR-API-154, ADR 2026-10-02 demo account) its merchant,
 * products, webhook endpoint and a real history of testnet meters. Run once inside the API
 * container; safe to run again (it adds meters, never duplicates the setup). Needs
 * FAUCET_PRIVATE_KEY, and the indexer running, since every meter waits for its stream to go live.
 * Takes about five minutes: the meters run for real.
 */
import { sql } from "../src/db/client";
import { seedDemo } from "../src/services/demo-seed";

try {
  await seedDemo();
  console.log("demo:seed done. Sign in at /login with Try the demo account and DEMO_PIN.");
} catch (e) {
  console.error(`demo:seed failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
