import { OpenAPIHono } from "@hono/zod-openapi";
import { app } from "../app";
import { config } from "../config";
import { ERROR_TYPES } from "../lib/errors";
import { WebhookEventSchema } from "../lib/event-schema";

/**
 * FR-API-085: the public OpenAPI document. Starts from the live document
 * (every route), keeps only operations marked with `PUBLIC` (the frozen SDK
 * surface), declares bearer auth and the FR-API-082 error envelope on each,
 * and prunes component schemas nothing public references. The webhook `Event`
 * body is kept on purpose although no public operation returns it: the docs
 * catalog validates its sample payloads against it (docs FR-DOC-030). `bun run openapi`
 * writes it to `api/openapi.json`; the docs site and the surface check read
 * that file, never the running API (docs BR-DOC-007).
 */

type Op = Record<string, unknown> & { operationId?: string; tags?: string[]; responses?: Record<string, unknown>; "x-public"?: boolean };
type Doc = { paths?: Record<string, Record<string, Op>>; components?: { schemas?: Record<string, unknown>; [k: string]: unknown }; [k: string]: unknown };

const TAGS = [
  { name: "Products", description: "Something billed at a rate per second." },
  { name: "Checkout", description: "Hosted pages a subscriber is sent to." },
  { name: "Subscriptions", description: "A running meter for one customer on one product." },
  { name: "Customers", description: "Subscribers, created by Checkout." },
  { name: "Invoices", description: "One settlement of accrued dollars for a period." },
];

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["type", "message"],
      properties: {
        type: { type: "string", enum: [...ERROR_TYPES] },
        message: { type: "string" },
        code: { type: "string", description: "Machine-readable reason, when there is one." },
        param: { type: "string", description: "The request field at fault, when there is one." },
      },
    },
  },
};

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

export function buildPublicOpenApi(): Doc {
  const doc = app.getOpenAPIDocument({
    openapi: "3.1.0",
    info: { title: "Elapse API", version: "2026-09-06", description: "Per-second billing. Authenticate with your secret key as a bearer token. Every amount is a decimal string in USD." },
    servers: [{ url: config.publicApiUrl }],
  }) as unknown as Doc;

  const paths: Record<string, Record<string, Op>> = {};
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || op["x-public"] !== true) continue;
      const { "x-public": _, ...rest } = op;
      (paths[path] ??= {})[method] = {
        ...rest,
        security: [{ bearerAuth: [] }],
        responses: { ...(rest.responses ?? {}), 400: errorResponse("Invalid request."), 401: errorResponse("Missing or invalid API key."), 404: errorResponse("No such object in this mode.") },
      };
    }
  }

  const allSchemas = doc.components?.schemas ?? {};
  const keep = new Set<string>(["Error"]);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "$ref" && typeof x === "string") {
        const name = x.replace("#/components/schemas/", "");
        if (!keep.has(name)) {
          keep.add(name);
          walk(allSchemas[name]);
        }
      } else walk(x);
    }
  };
  walk(paths);
  const schemas: Record<string, unknown> = { Error: ERROR_SCHEMA, Event: webhookEventSchema() };
  for (const name of Object.keys(allSchemas).sort()) if (keep.has(name)) schemas[name] = allSchemas[name];

  return {
    openapi: doc.openapi,
    info: doc.info,
    servers: doc.servers,
    tags: TAGS,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Your secret key: `sk_test_…` for test mode, `sk_live_…` for live. Server-side only." } },
      schemas,
    },
  };
}

/** The signed-body `Event`, rendered through the same registry as every other schema. */
function webhookEventSchema(): unknown {
  const scratch = new OpenAPIHono();
  scratch.openAPIRegistry.register("Event", WebhookEventSchema);
  const d = scratch.getOpenAPIDocument({ openapi: "3.1.0", info: { title: "x", version: "x" } }) as unknown as Doc;
  return d.components?.schemas?.Event;
}

/** Byte-stable rendering, so a diff means a real change. */
export function renderPublicOpenApi(): string {
  return `${JSON.stringify(buildPublicOpenApi(), null, 2)}\n`;
}
