/**
 * `bun run demo:seed [--reissue-examples] [--no-meters]` — give the demo account (FR-API-154; ADR
 * 2026-10-02 demo account, ADR 2026-10-02 examples on the demo merchant) its merchant, products,
 * webhook endpoints, the hosted examples' credentials, and a real history of testnet meters.
 *
 * Run inside the API container. Safe to run again: it adds meters and never duplicates the setup.
 * The examples' secret keys and signing secrets are printed **once**, the run that mints them, for
 * each example's `.env` on the host; they are not stored in plaintext anywhere, so copy them then.
 * `--reissue-examples` revokes and replaces them. `--no-meters` skips the five-minute meter run.
 * Meters need FAUCET_PRIVATE_KEY and the indexer running.
 */
import { sql } from "../src/db/client";
import { seedDemo, type SeedResult } from "../src/services/demo-seed";

const args = new Set(process.argv.slice(2));

function show({ publishableKey, examples }: SeedResult) {
  const minted = examples.filter((e) => e.secretKey || e.webhookSecret);
  if (minted.length === 0) {
    console.log("Examples' credentials unchanged (already issued). --reissue-examples replaces them.");
    return;
  }
  console.log("\nShown once — paste into each example's .env on the host, then restart it:");
  for (const e of minted) {
    console.log(`\n  examples/${e.example}/.env`);
    if (e.secretKey) console.log(`    ELAPSE_SECRET_KEY=${e.secretKey}`);
    if (publishableKey) console.log(`    ELAPSE_PUBLISHABLE_KEY=${publishableKey}`);
    if (e.webhookSecret) console.log(`    ELAPSE_WEBHOOK_SECRET=${e.webhookSecret}`);
  }
  console.log("");
}

try {
  await seedDemo({ reissueExamples: args.has("--reissue-examples"), meters: !args.has("--no-meters"), onProvisioned: show });
  console.log("demo:seed done. Sign in at /login with Try the demo account and DEMO_PIN.");
} catch (e) {
  console.error(`demo:seed failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
