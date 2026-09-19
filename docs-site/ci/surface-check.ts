/**
 * FR-DOC-042: the lists must agree, or the docs promise something the packages
 * do not have (BR-DOC-001):
 *   1. the methods `@elapse/sdk` exports (read from the client object itself),
 *   2. the methods the SDKs page documents (`### products.create` headings),
 *   3. the operationIds in the synced OpenAPI file,
 *   4. FR-DOC-047: what `@elapse/react` exports for a merchant to render or call,
 *      against the React page's own headings.
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

/**
 * FR-DOC-047: the components and hooks a merchant touches, read from `@elapse/react`'s export list
 * rather than by importing it — the docs site must not pull React in beside Mintlify's own.
 * Types, the math helpers and the popup plumbing are not on the page on purpose: this is the
 * surface someone renders or calls.
 */
export function reactExports(source = readFileSync(fileURLToPath(new URL("../../sdk/react/src/index.ts", import.meta.url)), "utf8")): string[] {
  const named = [...source.matchAll(/export\s*\{([^}]*)\}/g)].flatMap(([, body]) => body!.split(","));
  return named
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("type "))
    .map((entry) => entry.split(/\s+as\s+/).pop()!.trim())
    .filter((name) => /^[A-Z]/.test(name) || name.startsWith("use"))
    .filter((name) => !name.endsWith("Error") && name !== "useElapseConfig")
    .filter((v, i, all) => all.indexOf(v) === i)
    .sort();
}

/** `## <Meter>` / `## useMeter` headings on the React page. */
export function documentedReact(mdx = readFileSync(`${site}react.mdx`, "utf8")): string[] {
  return [...mdx.matchAll(/`<([A-Z][A-Za-z]*)>`|`(use[A-Z][A-Za-z]*)\(/g)]
    .map((m) => m[1] ?? m[2]!)
    .filter((v, i, all) => all.indexOf(v) === i)
    .sort();
}

export function diff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  return { onlyA: a.filter((x) => !b.includes(x)), onlyB: b.filter((x) => !a.includes(x)) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const sdk = sdkMethods();
  const problems: string[] = [];
  const reactDiff = diff(reactExports(), documentedReact());
  if (reactDiff.onlyA.length) problems.push(`React page is missing: ${reactDiff.onlyA.join(", ")}`);
  if (reactDiff.onlyB.length) problems.push(`React page documents what @elapse/react does not export: ${reactDiff.onlyB.join(", ")}`);
  for (const [name, list] of [["SDKs page", documentedMethods()], ["openapi.json", specOperations()]] as const) {
    const d = diff(sdk, list);
    if (d.onlyA.length) problems.push(`${name} is missing: ${d.onlyA.join(", ")}`);
    if (d.onlyB.length) problems.push(`${name} documents methods the SDK does not have: ${d.onlyB.join(", ")}`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Surface check: ${sdk.length} SDK methods and ${reactExports().length} React exports, documented and specified.`);
}
