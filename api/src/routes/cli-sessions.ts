import { createRoute, z } from "@hono/zod-openapi";
import { openCliSession } from "../db/cli-sessions";
import { sql } from "../db/client";
import { router } from "../lib/openapi";
import { requireAuth, type AuthEnv } from "../middleware/auth";

/**
 * CLI sessions (FR-API-130–133; CLI FRD FR-CLI-010–020). Secret-key only: the
 * CLI is a merchant tool. `POST /v1/cli/sessions` returns the merchant's CLI
 * endpoint and its signing secret for `elapse listen`.
 */
export const cliSessions = router<AuthEnv>();
cliSessions.use("/cli/*", requireAuth({ keys: ["sk"], session: false }));

export const CliSessionSchema = z
  .object({
    id: z.string().openapi({ example: "clis_7Hq2LmN8pR4sTvWx" }),
    object: z.literal("cli_session"),
    endpoint_id: z.string().openapi({ description: "The merchant's `kind: cli` webhook endpoint for this mode." }),
    signing_secret: z.string().openapi({ description: "Signs every Delivery streamed to this CLI. Same on every session." }),
    stream_url: z.string().openapi({ description: "Path of the SSE stream for this session." }),
    livemode: z.boolean(),
    merchant_name: z.string(),
  })
  .openapi("CliSession");

cliSessions.openapi(
  createRoute({
    method: "post",
    path: "/cli/sessions",
    operationId: "cli.sessions.create",
    tags: ["CLI"],
    responses: { 200: { description: "The session, with the CLI endpoint's signing secret.", content: { "application/json": { schema: CliSessionSchema } } } },
  }),
  async (c) => {
    const auth = c.get("auth");
    const s = await openCliSession({ merchantId: auth.merchantId, livemode: auth.livemode, actor: auth.actor });
    return c.json(
      { id: s.id, object: "cli_session" as const, endpoint_id: s.endpointId, signing_secret: s.signingSecret, stream_url: `/v1/cli/sessions/${s.id}/stream`, livemode: s.livemode, merchant_name: s.merchantName },
      200,
    );
  },
);

// ---------------------------------------------------------------------------
// FR-API-131 stream · FR-API-132 ack
// ---------------------------------------------------------------------------

import { streamSSE } from "hono/streaming";
import { findCliSession } from "../db/cli-sessions";
import { findDelivery } from "../db/deliveries";
import { ApiError, notFound } from "../lib/errors";
import { serializeDeliverySummary } from "./deliveries";
import { ackDelivery, CLI_STREAM_HEARTBEAT_MS, CLI_STREAM_POLL_MS, expireUnacked, nextFrames, touchConnected } from "../services/cli-stream";

const SessionParam = z.object({ id: z.string() });

cliSessions.openapi(
  createRoute({
    method: "get",
    path: "/cli/sessions/{id}/stream",
    operationId: "cli.sessions.stream",
    tags: ["CLI"],
    request: { params: SessionParam },
    responses: {
      200: {
        description:
          "Server-sent events. `event: delivery` frames `{id, event_id, type, created, headers, raw_body}` signed with the CLI endpoint's secret; `event: heartbeat` `{at}` every 15 s. While open, the CLI endpoint receives Deliveries; frames not acked are re-sent on the next connection.",
        content: { "text/event-stream": { schema: z.string() } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const auth = c.get("auth");
    const s = await findCliSession(auth.merchantId, auth.livemode, id);
    if (!s) throw notFound("cli session", id);
    await touchConnected(s.endpointId);
    await sql`UPDATE cli_sessions SET last_seen_at = now() WHERE id = ${s.id}`;
    return streamSSE(c, async (stream) => {
      const sent = new Set<string>();
      let lastBeat = 0; // first pass: expire, send what is queued, then the opening heartbeat
      let lastTouch = Date.now();
      while (!stream.aborted && !stream.closed) {
        try {
          await expireUnacked(s.endpointId);
          for (const frame of await nextFrames(s.endpointId, sent)) {
            sent.add(frame.id);
            await stream.writeSSE({ event: "delivery", id: frame.id, data: JSON.stringify(frame) });
            lastTouch = 0; // a frame counts as activity: touch on the next pass
          }
          const now = Date.now();
          if (now - lastBeat >= CLI_STREAM_HEARTBEAT_MS) {
            lastBeat = now;
            await stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ at: Math.floor(now / 1000) }) });
          }
          if (now - lastTouch >= Math.min(CLI_STREAM_HEARTBEAT_MS, 15_000)) {
            lastTouch = now;
            await touchConnected(s.endpointId);
          }
        } catch (e) {
          if (stream.aborted || stream.closed) break;
          console.error("cli stream", { session: s.id, message: (e as Error).message });
        }
        await stream.sleep(CLI_STREAM_POLL_MS);
      }
    });
  },
);

const AckBody = z
  .strictObject({
    status_code: z.number().int().min(100).max(599).optional(),
    error: z.string().max(200).optional(),
    duration_ms: z.number().int().min(0),
    printed_only: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional().openapi({ description: "The frame's headers, echoed so the attempt shows the signature." }),
    manual: z.boolean().optional().openapi({ description: "Echo the frame's `manual` flag: the attempt is recorded as a Resend." }),
  })
  .refine((b) => b.status_code !== undefined || b.error !== undefined || b.printed_only === true, { message: "Provide status_code, error, or printed_only." })
  .openapi("CliAck");

cliSessions.openapi(
  createRoute({
    method: "post",
    path: "/cli/sessions/{id}/deliveries/{delivery}/ack",
    operationId: "cli.sessions.ack",
    tags: ["CLI"],
    request: { params: z.object({ id: z.string(), delivery: z.string() }), body: { content: { "application/json": { schema: AckBody } }, required: true } },
    responses: { 200: { description: "The delivery after recording this attempt.", content: { "application/json": { schema: z.any() } } } },
  }),
  async (c) => {
    const { id, delivery } = c.req.valid("param");
    const body = c.req.valid("json");
    const auth = c.get("auth");
    const s = await findCliSession(auth.merchantId, auth.livemode, id);
    if (!s) throw notFound("cli session", id);
    const result = await ackDelivery(s.endpointId, delivery, body);
    if (result === "not_found") throw notFound("delivery", delivery);
    if (result === "already_acked") throw new ApiError(409, "invalid_request_error", "This delivery was already acknowledged.", undefined, "already_acked");
    const d = await findDelivery(auth.merchantId, auth.livemode, delivery);
    if (!d) throw notFound("delivery", delivery);
    return c.json(serializeDeliverySummary(d), 200);
  },
);
