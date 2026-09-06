import { sql } from "../db/client";
import { decryptSecret } from "../lib/crypto";
import { newId } from "../lib/ids";
import { signPayload } from "../lib/signature";

/**
 * The platform side of `elapse listen` (FR-API-131/132/134, ADR 2026-09-06).
 * The worker never touches `kind: cli` Deliveries; this module hands them to the
 * SSE stream as signed frames, records the CLI's ack as the single attempt, and
 * expires frames nobody acked.
 */

export const CLI_STREAM_POLL_MS = Number(process.env.CLI_STREAM_POLL_MS ?? 500);
export const CLI_STREAM_HEARTBEAT_MS = Number(process.env.CLI_STREAM_HEARTBEAT_MS ?? 15_000);
/** FR-CLI-018: how long the endpoint counts as connected after the last frame or heartbeat. */
export const CLI_CONNECTED_GRACE_S = 60;
/** FR-API-134: a CLI Delivery nobody acked in this long is skipped. */
export const CLI_ACK_TIMEOUT_S = 600;

export interface CliFrame {
  id: string;
  event_id: string;
  type: string;
  created: number;
  headers: Record<string, string>;
  raw_body: string;
  /** Present when this frame answers a Resend (FR-API-133); the ack records a manual attempt. */
  manual?: true;
}

/** Bump `cli_connected_until` so createEvent keeps matching this endpoint (FR-API-134). */
export async function touchConnected(endpointId: string): Promise<void> {
  await sql`UPDATE webhook_endpoints SET cli_connected_until = now() + make_interval(secs => ${CLI_CONNECTED_GRACE_S})
            WHERE id = ${endpointId} AND kind = 'cli'`;
}

/** Mark CLI Deliveries still `queued` after CLI_ACK_TIMEOUT_S as `skipped` with one recorded attempt. `null` = every CLI endpoint (the worker's sweep). Returns how many. */
export async function expireUnacked(endpointId: string | null, now = new Date()): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx`
      UPDATE deliveries SET status = 'skipped', attempt = attempt + 1, updated_at = now()
      WHERE (${endpointId}::text IS NULL OR endpoint_id = ${endpointId})
        AND endpoint_id IN (SELECT id FROM webhook_endpoints WHERE kind = 'cli')
        AND status = 'queued' AND manual_requested_at IS NULL
        AND created_at < ${now}::timestamptz - make_interval(secs => ${CLI_ACK_TIMEOUT_S})
      RETURNING id, attempt`;
    for (const r of rows) {
      await tx`INSERT INTO delivery_attempts (id, delivery_id, n, sent_at, error, actor, request_headers)
               VALUES (${newId("att")}, ${r.id}, ${r.attempt}, ${now}, 'cli_not_acked', 'system', '{}'::jsonb)`;
    }
    return rows.length;
  });
}

/**
 * Frames for every Delivery of this endpoint that is still `queued` (unacked) or
 * has a pending Resend, excluding ids already sent on this connection. Signs each
 * with the endpoint's current secret through the worker's helper (BR-CLI-001).
 * A pending Resend is consumed here (cleared) exactly as the worker's claim does.
 */
export async function nextFrames(endpointId: string, alreadySent: ReadonlySet<string>, now = new Date()): Promise<CliFrame[]> {
  const rows = await sql`
    SELECT d.id, d.event_id, d.manual_requested_at IS NOT NULL AS manual, e.type, e.created, e.raw_body,
           w.secret_enc, w.previous_secret_enc, w.previous_secret_expires_at
    FROM deliveries d
    JOIN events e ON e.id = d.event_id
    JOIN webhook_endpoints w ON w.id = d.endpoint_id
    WHERE d.endpoint_id = ${endpointId} AND (d.status = 'queued' OR d.manual_requested_at IS NOT NULL)
    ORDER BY e.seq`;
  const frames: CliFrame[] = [];
  const t = Math.floor(now.getTime() / 1000);
  for (const r of rows) {
    if (!r.manual && alreadySent.has(r.id)) continue;
    const secrets = [decryptSecret(r.secret_enc)];
    if (r.previous_secret_enc && r.previous_secret_expires_at && r.previous_secret_expires_at.getTime() > now.getTime()) {
      secrets.push(decryptSecret(r.previous_secret_enc));
    }
    if (r.manual) await sql`UPDATE deliveries SET manual_requested_at = NULL, manual_requested_by = NULL WHERE id = ${r.id}`;
    frames.push({
      id: r.id,
      event_id: r.event_id,
      type: r.type,
      created: Math.floor(new Date(r.created).getTime() / 1000),
      headers: { "Content-Type": "application/json", "X-Elapse-Signature": signPayload(r.raw_body, secrets, t), "X-Elapse-Delivery": r.id },
      raw_body: r.raw_body,
      ...(r.manual ? { manual: true as const } : {}),
    });
  }
  return frames;
}

export type AckResult = "ok" | "already_acked" | "not_found";

/**
 * FR-API-132: the CLI's report of what the local server answered. One attempt row
 * (`actor: "cli"`); 2xx or `printed_only` → `succeeded`, anything else → `exhausted`.
 * A manual (Resend) ack leaves status alone, like the worker's manual attempt.
 */
export async function ackDelivery(
  endpointId: string,
  deliveryId: string,
  input: { status_code?: number | undefined; error?: string | undefined; duration_ms: number; printed_only?: boolean | undefined; headers?: Record<string, string> | undefined; manual?: boolean | undefined },
  now = new Date(),
): Promise<AckResult> {
  return sql.begin(async (tx) => {
    const [d] = await tx`SELECT id, status, attempt FROM deliveries WHERE id = ${deliveryId} AND endpoint_id = ${endpointId} FOR UPDATE`;
    if (!d) return "not_found";
    if (!input.manual && d.status !== "queued") return "already_acked";
    const ok = input.printed_only === true || (input.status_code !== undefined && input.status_code >= 200 && input.status_code < 300);
    const n = (d.attempt as number) + 1;
    await tx`INSERT INTO delivery_attempts (id, delivery_id, n, manual, actor, sent_at, duration_ms, status_code, error, request_headers, response_excerpt)
             VALUES (${newId("att")}, ${d.id}, ${n}, ${input.manual === true}, 'cli', ${now}, ${input.duration_ms},
                     ${input.printed_only ? 200 : (input.status_code ?? null)}, ${input.error ?? null}, ${input.headers ?? {}}, ${input.printed_only ? "printed only (--no-forward)" : null})`;
    if (input.manual) {
      await tx`UPDATE deliveries SET attempt = ${n}, updated_at = now() WHERE id = ${d.id}`;
    } else {
      await tx`UPDATE deliveries SET status = ${ok ? "succeeded" : "exhausted"}, attempt = ${n}, updated_at = now() WHERE id = ${d.id}`;
    }
    return "ok";
  });
}

/** FR-API-134, worker side: sweep every CLI endpoint once a minute so a crashed CLI never leaves rows queued forever. */
export async function cliExpiryForever(signal?: AbortSignal, log?: (entry: Record<string, unknown>) => void, everyMs = 60_000): Promise<void> {
  while (!signal?.aborted) {
    try {
      const n = await expireUnacked(null);
      if (n > 0) log?.({ msg: "cli deliveries expired", count: n });
    } catch (e) {
      console.error("cli expiry sweep failed", { message: (e as Error).message });
    }
    await Bun.sleep(everyMs);
  }
}
