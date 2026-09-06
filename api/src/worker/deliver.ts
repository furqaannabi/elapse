import { sql } from "../db/client";
import { decryptSecret } from "../lib/crypto";
import { newId } from "../lib/ids";
import { signPayload } from "../lib/signature";
import { webhookUrlProblem } from "../lib/url-safety";
import type { Job } from "./queue";
import { MAX_ATTEMPTS, nextAttemptAt } from "./schedule";

export type Outcome = "succeeded" | "retrying" | "exhausted" | "skipped";
/** A manual (Resend) attempt reports only whether the endpoint answered 2xx; the delivery keeps its status. */
export type AttemptResult = { status: Outcome } | { status: "manual"; ok: boolean };

/** FR-WRK-062: ids and outcome only. Never the body, never a secret. */
export type DeliveryLogger = (entry: {
  delivery_id: string;
  event_id: string;
  type: string;
  endpoint_id: string;
  n: number;
  status_code: number | null;
  duration_ms: number;
  outcome: Outcome | "manual_ok" | "manual_failed";
  error: string | null;
}) => void;

export interface AttemptOptions {
  timeoutMs: number;
  now: () => Date;
  log: DeliveryLogger;
  fetchImpl?: typeof fetch;
}

const EXCERPT_BYTES = 1024;
const WARN_AFTER_MS = 24 * 3_600_000;
const DISABLE_AFTER_MS = 3 * 24 * 3_600_000;

/**
 * One attempt for one claimed job (FR-WRK-011–016, 020–023, 032, 040, 050).
 * Signs `raw_body` with the current secret and, inside a roll's grace window,
 * the previous one too; POSTs; records the attempt; schedules or finishes the
 * delivery; updates the endpoint's failure streak. Returns the new status.
 */
export async function attemptDelivery(job: Job, o: AttemptOptions): Promise<AttemptResult> {
  const n = job.attempt + 1;

  if (job.manual_actor) return manualAttempt(job, o, job.manual_actor);

  if (job.reclaimed) {
    // The previous holder died mid-attempt; keep the same n for the retry (FR-WRK-015).
    await sql`INSERT INTO delivery_attempts (id, delivery_id, n, sent_at, error)
              VALUES (${newId("att")}, ${job.id}, ${n}, ${o.now()}, 'lock_expired')`;
  }

  if (job.disabled) {
    await sql`UPDATE deliveries SET status = 'skipped', locked_until = NULL, updated_at = now() WHERE id = ${job.id}`;
    o.log({ delivery_id: job.id, event_id: job.event_id, type: job.type, endpoint_id: job.endpoint_id, n, status_code: null, duration_ms: 0, outcome: "skipped", error: "endpoint_disabled" });
    return { status: "skipped" };
  }

  const sentAt = o.now();
  const { headers, statusCode, error, excerpt, durationMs, ok } = await send(job, o, sentAt);

  let outcome: Outcome;
  let next: Date | null = null;
  if (ok) outcome = "succeeded";
  else {
    next = nextAttemptAt(n, sentAt);
    outcome = next ? "retrying" : "exhausted";
  }

  await sql.begin(async (tx) => {
    await tx`INSERT INTO delivery_attempts (id, delivery_id, n, sent_at, duration_ms, status_code, error, request_headers, response_excerpt)
             VALUES (${newId("att")}, ${job.id}, ${n}, ${sentAt}, ${durationMs}, ${statusCode}, ${error}, ${headers}, ${excerpt})`;
    await tx`UPDATE deliveries SET status = ${outcome}, attempt = ${n}, locked_until = NULL,
               next_attempt_at = COALESCE(${next}, next_attempt_at), updated_at = now()
             WHERE id = ${job.id}`;
    if (ok) {
      await tx`UPDATE webhook_endpoints SET failing_since = NULL, warned_24h_at = NULL, consecutive_failures = 0, updated_at = now() WHERE id = ${job.endpoint_id}`;
    } else {
      await recordFailure(tx, job, sentAt, outcome === "exhausted");
    }
  });

  o.log({ delivery_id: job.id, event_id: job.event_id, type: job.type, endpoint_id: job.endpoint_id, n, status_code: statusCode, duration_ms: durationMs, outcome, error });
  return { status: outcome };
}

/** Sign and POST once; the HTTP result, nothing persisted. Shared by automatic and manual attempts. */
async function send(job: Job, o: AttemptOptions, sentAt: Date) {
  const secrets = await activeSecrets(job, sentAt);
  const t = Math.floor(sentAt.getTime() / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Elapse/1.0",
    "X-Elapse-Signature": signPayload(job.raw_body, secrets, t),
    "X-Elapse-Delivery": job.id,
  };
  let statusCode: number | null = null;
  let error: string | null = null;
  let excerpt: string | null = null;
  const started = performance.now();
  const unsafe = await webhookUrlProblem(job.url, job.livemode);
  if (unsafe) {
    error = "unsafe_url";
  } else {
    try {
      const res = await (o.fetchImpl ?? fetch)(job.url, {
        method: "POST",
        headers,
        body: job.raw_body,
        redirect: "manual",
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      statusCode = res.status;
      excerpt = truncateUtf8(await res.text().catch(() => ""), EXCERPT_BYTES);
    } catch (e) {
      error = describeError(e);
    }
  }
  const durationMs = Math.round(performance.now() - started);
  const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
  return { headers, statusCode, error, excerpt, durationMs, ok };
}

/**
 * FR-WRK-030/031: a Resend. Freshly signed, sent now, recorded with
 * `manual = true` and the actor. Status, schedule, `pending_webhooks` and the
 * endpoint's failure streak are untouched; only the lock is released.
 */
async function manualAttempt(job: Job, o: AttemptOptions, actor: string): Promise<AttemptResult> {
  const sentAt = o.now();
  const { headers, statusCode, error, excerpt, durationMs, ok } = await send(job, o, sentAt);
  let n = 0;
  await sql.begin(async (tx) => {
    // Numbered after every attempt so far, automatic or manual, so three resends read 2, 3, 4 (found 2026-09-06).
    const [{ next }] = await tx`SELECT COALESCE(MAX(n), 0) + 1 AS next FROM delivery_attempts WHERE delivery_id = ${job.id}`;
    n = Number(next);
    await tx`INSERT INTO delivery_attempts (id, delivery_id, n, manual, actor, sent_at, duration_ms, status_code, error, request_headers, response_excerpt)
             VALUES (${newId("att")}, ${job.id}, ${n}, true, ${actor}, ${sentAt}, ${durationMs}, ${statusCode}, ${error}, ${headers}, ${excerpt})`;
    await tx`UPDATE deliveries SET locked_until = NULL, updated_at = now() WHERE id = ${job.id}`;
  });
  o.log({ delivery_id: job.id, event_id: job.event_id, type: job.type, endpoint_id: job.endpoint_id, n, status_code: statusCode, duration_ms: durationMs, outcome: ok ? "manual_ok" : "manual_failed", error });
  return { status: "manual", ok };
}

/** Current secret, plus the previous one while its grace window is open; nulls an expired previous secret (FR-WRK-040). */
async function activeSecrets(job: Job, now: Date): Promise<string[]> {
  const secrets = [decryptSecret(job.secret_enc)];
  if (job.previous_secret_enc && job.previous_secret_expires_at) {
    if (job.previous_secret_expires_at.getTime() > now.getTime()) {
      secrets.push(decryptSecret(job.previous_secret_enc));
    } else {
      await sql`UPDATE webhook_endpoints SET previous_secret_enc = NULL, previous_secret_expires_at = NULL, updated_at = now()
                WHERE id = ${job.endpoint_id} AND previous_secret_expires_at <= ${now}`;
    }
  }
  return secrets;
}

/**
 * FR-WRK-050: start or extend the failure streak; warn once past 24 h;
 * disable past 3 days with an audit row and a notification.
 */
async function recordFailure(tx: typeof sql, job: Job, at: Date, exhausted: boolean) {
  const [ep] = await tx`
    UPDATE webhook_endpoints
    SET failing_since = COALESCE(failing_since, ${at}),
        consecutive_failures = consecutive_failures + ${exhausted ? 1 : 0},
        updated_at = now()
    WHERE id = ${job.endpoint_id}
    RETURNING failing_since, warned_24h_at, disabled, url`;
  if (!ep || ep.disabled) return;
  const streakMs = at.getTime() - new Date(ep.failing_since).getTime();

  if (streakMs >= DISABLE_AFTER_MS) {
    await tx`UPDATE webhook_endpoints SET disabled = true, disabled_reason = 'auto:failing_3d', updated_at = now() WHERE id = ${job.endpoint_id}`;
    await tx`INSERT INTO audit_log (merchant_id, actor, action, target) VALUES (${job.merchant_id}, 'system:worker', 'webhook_endpoint.auto_disabled', ${job.endpoint_id})`;
    await tx`INSERT INTO notifications (id, merchant_id, livemode, kind, summary, target_id)
             VALUES (${newId("ntf")}, ${job.merchant_id}, ${job.livemode}, 'endpoint_exhausted',
                     ${`Webhook endpoint ${hostOf(ep.url)} stopped retrying after 3 days of failures and was disabled.`}, ${job.endpoint_id})`;
  } else if (streakMs >= WARN_AFTER_MS && !ep.warned_24h_at) {
    await tx`UPDATE webhook_endpoints SET warned_24h_at = ${at}, updated_at = now() WHERE id = ${job.endpoint_id}`;
    await tx`INSERT INTO notifications (id, merchant_id, livemode, kind, summary, target_id)
             VALUES (${newId("ntf")}, ${job.merchant_id}, ${job.livemode}, 'endpoint_failing',
                     ${`Webhook endpoint ${hostOf(ep.url)} has been failing for 24 hours. It will be disabled after 3 days.`}, ${job.endpoint_id})`;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function truncateUtf8(s: string, max: number): string {
  const buf = Buffer.from(s, "utf8");
  return buf.length <= max ? s : buf.subarray(0, max).toString("utf8");
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
    const code = (e as { code?: string }).code;
    return code ? `${code}: ${e.message}`.slice(0, 200) : e.message.slice(0, 200);
  }
  return String(e).slice(0, 200);
}
