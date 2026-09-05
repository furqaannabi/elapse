import { runForever } from "./run";

/**
 * Webhook worker entrypoint: `bun run worker` (ADR 2026-09-05: second process
 * from the api/ package). Delivers Events to Merchant endpoints from the
 * Postgres queue. Env: DATABASE_URL, WEBHOOK_SECRET_KEK, WORKER_CONCURRENCY, WORKER_BATCH.
 */
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 16);
const batch = Number(process.env.WORKER_BATCH ?? 50);
const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => controller.abort());

console.log(`elapse worker started (concurrency ${concurrency}, batch ${batch})`);
await runForever(
  { batch, concurrency, timeoutMs: 10_000, log: (entry) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry })) },
  controller.signal,
);
console.log("elapse worker stopped");
