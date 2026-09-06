/**
 * `pnpm --filter docs-site sync-snippets [--check]` (FR-DOC-011, FR-DOC-023,
 * FR-DOC-024, FR-DOC-030, FR-DOC-032, FR-DOC-044, BR-DOC-003).
 *
 * Every code sample and every number on the docs site that could drift is
 * written here from its source of truth, never typed into a page:
 *
 *   example-<region>.mdx   `// region:` blocks in examples/saas source
 *   payload-<type>.mdx     the six webhook bodies, validated against the API's signed-body Event schema
 *   contracts.mdx          addresses from contracts/deployments
 *   retry-schedule.mdx     the worker's schedule constant
 *   error-types.mdx        the Error enum in api/openapi.json
 *   cli-listen.mdx         the CLI test suite's output fixture
 *   signature-vector.mdx   the test vector the SDK suite verifies (sdk/ts/test/docs-vector.json)
 *   ../openapi.json        a copy of api/openapi.json at the site root, where docs.json points
 *
 * `--check` writes nothing and exits 1 naming any file that differs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES } from "../../api/src/lib/event-types";
import { WebhookEventSchema } from "../../api/src/lib/event-schema";
import { sampleObject } from "../../api/src/lib/sample-objects";
import { RETRY_DELAYS_S } from "../../api/src/worker/schedule";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_SITE = join(ROOT, "docs-site/site");

/** Lines between `// region:<name>` and `// endregion`, dedented by the marker's indent. */
export function extractRegion(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.trim() === `// region:${name}`);
  if (start < 0) throw new Error(`region "${name}" not found`);
  const indent = lines[start]!.match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === "// endregion") return body.join("\n");
    body.push(l.slice(Math.min(indent, l.match(/^\s*/)![0].length)));
  }
  throw new Error(`region "${name}" has no endregion`);
}

const fence = (lang: string, code: string, title?: string) => `\`\`\`${lang}${title ? ` ${title}` : ""}\n${code.replace(/\n$/, "")}\n\`\`\`\n`;
const human = (s: number) => (s === 0 ? "0 s" : s < 60 ? `${s} s` : s < 3600 ? `${s / 60} m` : `${s / 3600} h`);

/** A signed-body Event around a sample object, at a fixed clock so the file is byte-stable. */
function samplePayload(type: (typeof EVENT_TYPES)[number]): string {
  const now = 1_757_160_000; // 2026-09-06T12:00:00Z
  const event = { id: `evt_test_${type.replace(/\./g, "_")}`, object: "event", type, created: now, livemode: false, pending_webhooks: 1, data: { object: sampleObject(type, false, now) } };
  const parsed = WebhookEventSchema.safeParse(event);
  if (!parsed.success) throw new Error(`sample ${type} does not match the Event schema: ${parsed.error.message}`);
  return `${JSON.stringify(event, null, 2)}\n`;
}

function build(): Record<string, string> {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  const out: Record<string, string> = {};

  const boot = read("examples/saas/src/boot.ts");
  const hooks = read("examples/saas/src/webhooks.ts");
  for (const name of ["client", "product", "session"]) out[`example-${name}.mdx`] = fence("ts", extractRegion(boot, name), "server.ts");
  for (const name of ["verify", "handle"]) out[`example-${name}.mdx`] = fence("ts", extractRegion(hooks, name), "webhooks.ts");

  for (const type of EVENT_TYPES) out[`payload-${type}.mdx`] = fence("json", samplePayload(type), type);

  const d = JSON.parse(read("contracts/deployments/10143.json")) as Record<string, string | number>;
  out["contracts.mdx"] = [
    "| Contract | Monad testnet (chain 10143) |",
    "| --- | --- |",
    `| \`StreamFactory\` | \`${d.factory}\` |`,
    `| \`AccrualStream\` implementation | \`${d.implementation}\` |`,
    `| Test token (MockUSD, ${d.ausdDecimals} decimals) | \`${d.mockUsd}\` |`,
    `| Deployed at block | ${d.deployedAtBlock} |`,
    `| Platform fee | ${Number(d.feeBps) / 100}% of each settlement |`,
    "",
  ].join("\n");

  const tries = RETRY_DELAYS_S.map((s, i) => `| ${i + 1} | ${i === 0 ? "immediately" : `${human(s)} after attempt ${i}`} |`);
  out["retry-schedule.mdx"] = ["| Attempt | When |", "| --- | --- |", ...tries, "", `After attempt ${RETRY_DELAYS_S.length} fails, the Delivery is marked exhausted and the dashboard shows Resend.`, ""].join("\n");

  const openapi = read("api/openapi.json");
  out["../openapi.json"] = openapi;
  const types = (JSON.parse(openapi).components.schemas.Error.properties.error.properties.type.enum as string[]).map((t) => `- \`${t}\``);
  out["error-types.mdx"] = `${types.join("\n")}\n`;

  out["cli-listen.mdx"] = fence("text", read("cli/test/fixtures/listen-output.txt"));

  const v = JSON.parse(read("sdk/ts/test/docs-vector.json")) as { secret: string; t: number; body: string; v1: string };
  out["signature-vector.mdx"] = [
    "| | |",
    "| --- | --- |",
    `| Secret | \`${v.secret}\` |`,
    `| \`t\` | \`${v.t}\` |`,
    `| Header | \`t=${v.t},v1=${v.v1}\` |`,
    "",
    fence("json", v.body, "raw body, exactly these bytes"),
  ].join("\n");
  return out;
}

/** Writes (or, with `check`, compares) every snippet. Returns the list of files written or found stale. */
export async function sync(o: { siteDir?: string; check: boolean }): Promise<string[]> {
  const outDir = join(o.siteDir ?? DEFAULT_SITE, "snippets");
  const files = build();
  const touched: string[] = [];
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(outDir, name);
    const current = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    if (o.check) {
      if (current !== content) touched.push(name);
    } else {
      writeFileSync(target, content);
      touched.push(name);
    }
  }
  return touched.sort();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const check = process.argv.includes("--check");
  const result = await sync({ check });
  if (check) {
    if (result.length) {
      console.error(`Stale snippets: ${result.join(", ")}. Run \`pnpm --filter docs-site sync-snippets\` and commit.`);
      process.exit(1);
    }
    console.log("Snippets are up to date.");
  } else console.log(`Wrote ${result.length} snippets to docs-site/site/snippets.`);
}
