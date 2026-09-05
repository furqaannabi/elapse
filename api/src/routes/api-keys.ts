import { createRoute, z } from "@hono/zod-openapi";
import { createApiKey, listApiKeys, revokeApiKey, rollApiKey, type ApiKeyListRow, type ApiKeyRow } from "../db/api-keys";
import { invalid, notFound } from "../lib/errors";
import { router } from "../lib/openapi";
import { clientIp, sessionAuth, type AuthEnv } from "../middleware/auth";

/**
 * API keys (FR-API-002, FR-API-003, FR-API-105). Dashboard cookie only, never
 * a secret key. Plaintext of an `sk_` is returned exactly once, on create and
 * roll; lists show `sk_test_…abcd`. Hidden from the public OpenAPI.
 */

const unix = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);

const ApiKeySchema = z
  .object({
    id: z.string(),
    object: z.literal("api_key"),
    kind: z.enum(["pk", "sk"]),
    name: z.string(),
    livemode: z.boolean(),
    last4: z.string(),
    redacted: z.string().openapi({ description: "`sk_test_…abcd`; for pk the full key." }),
    publishable_key: z.string().optional(),
    created: z.number().int(),
    last_used_at: z.number().int().nullable(),
    revoked_at: z.number().int().nullable(),
    expires_at: z.number().int().nullable(),
    secret: z.string().optional().openapi({ description: "Only on create and roll. Never shown again." }),
  })
  .openapi("ApiKey");

function serializeKey(k: ApiKeyListRow | (ApiKeyRow & Partial<ApiKeyListRow>), secret?: string) {
  const prefix = `${k.kind}_${k.livemode ? "live" : "test"}_`;
  return {
    id: k.id,
    object: "api_key" as const,
    kind: k.kind,
    name: k.name,
    livemode: k.livemode,
    last4: k.last4,
    redacted: k.kind === "pk" && k.plaintext ? k.plaintext : `${prefix}…${k.last4}`,
    ...(k.kind === "pk" && k.plaintext ? { publishable_key: k.plaintext } : {}),
    created: k.created_at ? Math.floor(k.created_at.getTime() / 1000) : Math.floor(Date.now() / 1000),
    last_used_at: unix(k.last_used_at ?? null),
    revoked_at: unix(k.revoked_at ?? null),
    expires_at: unix(k.expires_at ?? null),
    ...(secret ? { secret } : {}),
  };
}

export const apiKeys = router<AuthEnv>();
apiKeys.use("/api_keys", sessionAuth());
apiKeys.use("/api_keys/*", sessionAuth());

const IdParam = z.object({ id: z.string() });

apiKeys.openapi(
  createRoute({
    method: "get",
    path: "/api_keys",
    operationId: "apiKeys.list",
    tags: ["Dashboard"],
    hide: true,
    responses: { 200: { description: "Keys for the current mode.", content: { "application/json": { schema: z.object({ object: z.literal("list"), data: z.array(ApiKeySchema) }) } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const rows = await listApiKeys(auth.merchantId, auth.livemode);
    return c.json({ object: "list" as const, data: rows.map((k) => serializeKey(k)) }, 200);
  },
);

apiKeys.openapi(
  createRoute({
    method: "post",
    path: "/api_keys",
    operationId: "apiKeys.create",
    tags: ["Dashboard"],
    hide: true,
    request: { body: { content: { "application/json": { schema: z.strictObject({ name: z.string().min(1).max(100) }) } }, required: true } },
    responses: { 200: { description: "The new secret key, shown once.", content: { "application/json": { schema: ApiKeySchema } } } },
  }),
  async (c) => {
    const { name } = c.req.valid("json");
    const auth = c.get("auth");
    const ip = clientIp(c);
    const { row, plaintext } = await createApiKey({ merchantId: auth.merchantId, kind: "sk", livemode: auth.livemode, name, actor: auth.actor, ...(ip ? { ip } : {}) });
    return c.json(serializeKey({ ...row, plaintext: null, created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null }, plaintext), 200);
  },
);

apiKeys.openapi(
  createRoute({
    method: "post",
    path: "/api_keys/{id}/roll",
    operationId: "apiKeys.roll",
    tags: ["Dashboard"],
    hide: true,
    request: {
      params: IdParam,
      body: { content: { "application/json": { schema: z.strictObject({ grace: z.union([z.literal(0), z.literal(3600), z.literal(86400)]) }) } }, required: true },
    },
    responses: { 200: { description: "The replacement key, shown once; the old key expires after the grace.", content: { "application/json": { schema: ApiKeySchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { grace } = c.req.valid("json");
    const auth = c.get("auth");
    const result = await rollApiKey(auth.merchantId, auth.livemode, id, grace, auth.actor, clientIp(c));
    if (!result) throw invalid(`Key '${id}' is not an active secret key in this mode.`, "id");
    return c.json(serializeKey({ ...result.row, plaintext: null, created_at: new Date(), last_used_at: null, revoked_at: null, expires_at: null }, result.plaintext), 200);
  },
);

apiKeys.openapi(
  createRoute({
    method: "delete",
    path: "/api_keys/{id}",
    operationId: "apiKeys.revoke",
    tags: ["Dashboard"],
    hide: true,
    request: { params: IdParam },
    responses: { 200: { description: "Revoked; the row stays for the audit trail.", content: { "application/json": { schema: ApiKeySchema } } } },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const row = await revokeApiKey(auth.merchantId, auth.livemode, id, auth.actor, clientIp(c));
    if (!row) throw notFound("api key", id);
    return c.json(serializeKey(row), 200);
  },
);
