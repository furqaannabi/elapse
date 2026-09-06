/**
 * FR-API-085: the committed public OpenAPI file. Exactly the SDK's methods,
 * nothing internal, bearer auth declared, and the file on disk is fresh.
 */
import { describe, expect, it } from "bun:test";
import { Elapse } from "@elapse/sdk";
import { buildPublicOpenApi } from "../src/openapi/public";

/** The nine REST methods the SDK exposes, derived from the client itself so the test cannot drift. */
function sdkOperationIds(): string[] {
  const client = new Elapse({ secretKey: "sk_test_x" }) as unknown as Record<string, unknown>;
  const walk = (obj: Record<string, unknown>, prefix: string): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "function" ? [`${prefix}${k}`] : v && typeof v === "object" ? walk(v as Record<string, unknown>, `${prefix}${k}.`) : [],
    );
  return ["products", "checkout", "subscriptions", "customers", "invoices"].flatMap((r) => walk(client[r] as Record<string, unknown>, `${r}.`)).sort();
}

const operationIds = (doc: ReturnType<typeof buildPublicOpenApi>) =>
  Object.values(doc.paths ?? {})
    .flatMap((p) => Object.values(p as Record<string, { operationId?: string }>).map((op) => op.operationId ?? ""))
    .filter(Boolean)
    .sort();

describe("FR-API-085 public OpenAPI", () => {
  it("contains exactly the SDK's operations", () => {
    expect(operationIds(buildPublicOpenApi())).toEqual(sdkOperationIds());
  });
});

describe("FR-API-085 shape", () => {
  const doc = buildPublicOpenApi();
  const ops = Object.values(doc.paths ?? {}).flatMap((p) => Object.values(p));

  it("declares bearer auth and the error envelope on every operation", () => {
    expect(doc.components?.securitySchemes).toEqual({ bearerAuth: expect.objectContaining({ type: "http", scheme: "bearer" }) });
    for (const op of ops) {
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      const codes = Object.keys(op.responses ?? {});
      expect(codes.some((c) => c === "200" || c === "202")).toBe(true);
      expect(codes).toEqual(expect.arrayContaining(["400", "401", "404"]));
    }
    expect((doc.components?.schemas as Record<string, unknown>).Error).toBeDefined();
  });

  it("names the hosted server and the five resource tags in order", () => {
    expect(doc.servers).toEqual([{ url: "http://localhost:4000" }]);
    expect((doc.tags as Array<{ name: string }>).map((t) => t.name)).toEqual(["Products", "Checkout", "Subscriptions", "Customers", "Invoices"]);
  });

  it("keeps only schemas the public operations reach, and no x-public marker", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toContain("x-public");
    const schemas = Object.keys(doc.components?.schemas ?? {});
    // Error and Event are kept on purpose; everything else must be referenced by a public operation.
    for (const name of schemas) expect(text.split(`#/components/schemas/${name}"`).length > 1 || name === "Error" || name === "Event").toBe(true);
    expect(schemas).not.toContain("Delivery");
  });

  it("carries the webhook Event schema for the docs catalog, in its signed-body shape", () => {
    const event = (doc.components?.schemas as Record<string, { required?: string[]; properties?: Record<string, unknown> }>).Event;
    expect(event).toBeDefined();
    expect(event!.required).toEqual(expect.arrayContaining(["id", "object", "type", "created", "livemode", "data", "pending_webhooks"]));
    expect(Object.keys(event!.properties ?? {})).not.toEqual(expect.arrayContaining(["object_id"]));
    expect(Object.keys(event!.properties ?? {})).not.toEqual(expect.arrayContaining(["delivery_state"]));
    expect((event!.properties!.type as { enum: string[] }).enum).toHaveLength(6);
  });

  it("matches the committed api/openapi.json byte for byte (run `bun run openapi` after a public route change)", async () => {
    const { renderPublicOpenApi } = await import("../src/openapi/public");
    const committed = await Bun.file(new URL("../openapi.json", import.meta.url)).text();
    expect(committed).toBe(renderPublicOpenApi());
  });
});
