import "dotenv/config";
import { boot } from "./boot";
import { ConfigError, loadConfig } from "./config";

/**
 * `npm start` (FR-EXM-002, FR-EXM-003, FR-EXM-024). Reads `.env`, boots, and
 * prints each received Event as `HH:MM:SS  evt_…  type  → action`.
 */

const clock = () => new Date().toTimeString().slice(0, 8);

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

boot(config, {
  out: (line) => console.log(line),
  log: (line) => console.log(line.startsWith("{") ? line : `${clock()}  ${line}`),
  logJson: process.env.LOG_JSON !== "0",
}).catch((err: Error) => {
  console.error(`Could not start: ${err.message}`);
  process.exit(1);
});
