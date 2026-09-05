import { app } from "./app";
import { config } from "./config";

/** Entrypoint: `bun run dev` / `bun run start`. Migrations run separately (`bun run migrate`). */
export default {
  port: config.port,
  fetch: app.fetch,
};
console.log(`elapse api listening on :${config.port}`);
