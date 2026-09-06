/**
 * FR-DOC-042: three lists must agree, or the docs promise something the SDK
 * does not have (BR-DOC-001):
 *   1. the methods `@elapse/sdk` exports (read from the client object itself),
 *   2. the methods the SDKs page documents (`### products.create` headings),
 *   3. the operationIds in the synced OpenAPI file.
 * Exit 1 with the differences named.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Elapse } from "@elapse/sdk";

const site = fileURLToPath(new URL("../site/", import.meta.url));

export function sdkMethods(): string[] {
  const client = new Elapse({ secretKey: "sk_test_x" }) as unknown as Record<string, unknown>;
  const walk = (obj: Record<string, unknown>, prefix: string): string[] =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === "function" ? [`${prefix}${k}`] : v && typeof v === "object" ? walk(v as Record<string, unknown>, `${prefix}${k}.`) : []));
  return ["products", "checkout", "subscriptions", "customers", "invoices"].flatMap((r) => walk(client[r] as Record<string, unknown>, `${r}.`)).sort();
}

export function documentedMethods(mdx = readFileSync(`${site}sdks.mdx`, "utf8")): string[] {
  return [...mdx.matchAll(/^### `([a-z]+(?:\.[a-zA-Z]+)+)`/gm)].map((m) => m[1]!).filter((m) => !m.startsWith("webhooks.")).sort();
}

export function specOperations(json = readFileSync(`${site}openapi.json`, "utf8")): string[] {
  const doc = JSON.parse(json) as { paths: Record<string, Record<string, { operationId: string }>> };
  return Object.values(doc.paths).flatMap((p) => Object.values(p).map((op) => op.operationId)).sort();
}

export function diff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  return { onlyA: a.filter((x) => !b.includes(x)), onlyB: b.filter((x) => !a.includes(x)) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const sdk = sdkMethods();
  const problems: string[] = [];
  for (const [name, list] of [["SDKs page", documentedMethods()], ["openapi.json", specOperations()]] as const) {
    const d = diff(sdk, list);
    if (d.onlyA.length) problems.push(`${name} is missing: ${d.onlyA.join(", ")}`);
    if (d.onlyB.length) problems.push(`${name} documents methods the SDK does not have: ${d.onlyB.join(", ")}`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Surface check: ${sdk.length} SDK methods, documented and specified.`);
}
