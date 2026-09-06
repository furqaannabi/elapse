import { runForever } from "./run";
import { keeperForever, KEEPER_CADENCE_S, KEEPER_TICK_MS } from "./keeper";
import { heartbeatForever } from "./heartbeat";
import { cliExpiryForever } from "../services/cli-stream";
import { newId } from "../lib/ids";

/**
 * Webhook worker entrypoint: `bun run worker` (ADR 2026-09-05: second process
 * from the api/ package). Delivers Events to Merchant endpoints from the
 * Postgres queue, and runs the keeper that asks the chain to settle running streams every
 * KEEPER_CADENCE_S (5 min) and to end capped ones (FR-WRK-070/071), and sweeps CLI Deliveries
 * nobody acked in 10 min to `skipped` (FR-API-134). Env: DATABASE_URL,
 * WEBHOOK_SECRET_KEK, WORKER_CONCURRENCY, WORKER_BATCH, KEEPER_CADENCE_S, KEEPER_TICK_MS,
 * plus RELAYER_PRIVATE_KEY / MONAD_RPC_URL / CHAIN_ID for the keeper (KEEPER=0 disables it).
 */
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 16);
const batch = Number(process.env.WORKER_BATCH ?? 50);
const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => controller.abort());

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
const workerId = process.env.WORKER_ID ?? newId("wrk");
let keeperTick: Date | null = null;
const keeperOn = process.env.KEEPER !== "0";
console.log(`elapse worker started (concurrency ${concurrency}, batch ${batch}, keeper ${keeperOn ? `every ${KEEPER_TICK_MS / 1000}s, cadence ${KEEPER_CADENCE_S}s` : "off"})`);
await Promise.all([
  runForever({ batch, concurrency, timeoutMs: 10_000, log }, controller.signal),
  keeperOn ? keeperForever(controller.signal, log, () => { keeperTick = new Date(); }) : Promise.resolve(),
  heartbeatForever(workerId, () => keeperTick, controller.signal),
  cliExpiryForever(controller.signal, log),
]);
console.log("elapse worker stopped");
