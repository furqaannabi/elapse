/**
 * `bun run demo:reset` — put the demo account's test-mode configuration back to its seed now
 * (FR-WRK-076), the same reset the worker runs every six hours. History is never touched.
 */
import { sql } from "../src/db/client";
import { resetDemo } from "../src/worker/demo-reset";

try {
  console.log((await resetDemo()) ? "demo configuration reset." : "No demo merchant yet: run demo:seed first.");
} catch (e) {
  console.error(`demo:reset failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
