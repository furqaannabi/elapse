import { app } from "./app";
import { config } from "./config";

/** Entrypoint: `bun run dev` / `bun run start`. Migrations run separately (`bun run migrate`). */
export default {
  port: config.port,
  fetch: app.fetch,
  // The CLI stream (FR-API-131) heartbeats every 15 s; Bun's default 10 s idle timeout would cut it.
  idleTimeout: 60,
};
console.log(`elapse api listening on :${config.port}`);
