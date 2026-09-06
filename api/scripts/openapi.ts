/**
 * `bun run openapi` (FR-API-085): write the public OpenAPI document to
 * `api/openapi.json`. `bun test` fails until this is rerun after a change to a
 * public route. Pass `--check` to exit 1 instead of writing when it is stale.
 */
import { renderPublicOpenApi } from "../src/openapi/public";

const target = new URL("../openapi.json", import.meta.url);
const next = renderPublicOpenApi();
const file = Bun.file(target);
const current = (await file.exists()) ? await file.text() : "";

if (process.argv.includes("--check")) {
  if (current === next) {
    console.log("openapi.json is up to date.");
    process.exit(0);
  }
  console.error("openapi.json is stale. Run `bun run openapi` and commit the result.");
  process.exit(1);
}
await Bun.write(target, next);
const ops = Object.values(JSON.parse(next).paths as Record<string, object>).reduce((n, p) => n + Object.keys(p).length, 0);
console.log(`Wrote ${target.pathname} (${ops} public operations).`);
process.exit(0);
