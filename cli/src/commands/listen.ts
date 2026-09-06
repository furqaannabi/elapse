import { forward as forwardTo } from "../forward";
import { clock, paint, prettyJson, shortId } from "../format";
import { Platform, PlatformError, type CliSession } from "../platform";
import { readSSE, SSEConnectError } from "../sse";

/**
 * `elapse listen --forward <url>` (FR-CLI-010–018). Opens a CLI session, reads
 * the SSE stream, prints each Delivery, forwards the exact bytes to the local
 * URL, and acks with the local response so the dashboard shows it.
 */

export const MVP_EVENT_TYPES = ["checkout.session.completed", "subscription.created", "subscription.updated", "subscription.canceled", "invoice.settled", "invoice.payment_failed"] as const;

export interface ListenOptions {
  baseUrl: string;
  key: string;
  /** Local URL; `undefined` = `--no-forward` (print only). */
  forward: string | undefined;
  events: string[] | undefined;
  compact: boolean;
  printSecret: boolean;
  live: boolean;
  json: boolean;
  color: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  forwardTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ListenSummary {
  received: number;
  forwarded: number;
  failed: number;
  skipped: number;
}

interface Frame {
  id: string;
  event_id: string;
  type: string;
  created: number;
  headers: Record<string, string>;
  raw_body: string;
  manual?: true;
}

/** `localhost:3000/webhooks` → `http://localhost:3000/webhooks` (FR-CLI-010). */
export function normalizeForwardUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

export class ListenError extends Error {
  constructor(message: string, public readonly exitCode: 1 | 2) {
    super(message);
  }
}

export async function listen(o: ListenOptions): Promise<ListenSummary> {
  const p = paint(o.color);
  const platform = new Platform(o.baseUrl, o.key, o.fetchImpl);
  let session: CliSession;
  try {
    session = await platform.openSession();
  } catch (e) {
    if (e instanceof PlatformError && e.status === 401) throw new ListenError(e.message, 2);
    throw new ListenError(`Could not reach Elapse at ${o.baseUrl}: ${(e as Error).message}`, 1);
  }
  if (session.livemode) {
    o.stderr(p.red(p.bold("LIVE")) + " mode: this key is live. Deliveries here are real money events.");
    if (!o.live) throw new ListenError("Refusing to listen in LIVE mode without --live.", 2);
  }
  const forwardUrl = o.forward ? normalizeForwardUrl(o.forward) : undefined;
  const filter = o.events ? new Set(o.events) : null;
  const summary: ListenSummary = { received: 0, forwarded: 0, failed: 0, skipped: 0 };

  o.stdout(`Elapse CLI 0.1.0 · ${session.livemode ? p.red("LIVE mode") : "test mode"} · merchant ${session.merchant_name}`);
  o.stdout(`Your webhook signing secret is ${p.bold(session.signing_secret)}  (put it in ELAPSE_WEBHOOK_SECRET)`);
  if (o.printSecret) o.stdout(`ELAPSE_WEBHOOK_SECRET=${session.signing_secret}`);
  o.stdout(forwardUrl ? `Ready. Forwarding to ${forwardUrl}` : "Ready. Printing only (--no-forward)");
  o.stdout("");

  const frames = readSSE(platform.streamUrl(session), {
    key: o.key,
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    onReconnect: (n, delay) => o.stderr(p.yellow(`Connection lost. Reconnecting in ${Math.round(delay / 1000)} s (attempt ${n})`)),
  });
  try {
    for await (const f of frames) {
      if (f.event !== "delivery") continue;
      let frame: Frame;
      try {
        frame = JSON.parse(f.data) as Frame;
      } catch {
        o.stderr("Ignored a malformed frame from the platform.");
        continue;
      }
      summary.received++;
      const head = `${clock()}  ${shortId(frame.event_id).padEnd(9)}  ${frame.type.padEnd(26)}`;
      const manual = frame.manual ? { manual: true } : {};
      if (filter && !filter.has(frame.type)) {
        summary.skipped++;
        o.stdout(`${head} ${p.dim("skipped (--events)")}`);
        await safeAck(platform, session, frame.id, { printed_only: true, duration_ms: 0, headers: frame.headers, ...manual }, o.stderr);
        continue;
      }
      if (!forwardUrl) {
        o.stdout(`${head} printed`);
        printBody(o, frame);
        await safeAck(platform, session, frame.id, { printed_only: true, duration_ms: 0, headers: frame.headers, ...manual }, o.stderr);
        continue;
      }
      const r = await forwardTo(forwardUrl, frame.raw_body, frame.headers, { ...(o.forwardTimeoutMs ? { timeoutMs: o.forwardTimeoutMs } : {}), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
      if (r.ok) {
        const okish = r.status >= 200 && r.status < 300;
        if (okish) summary.forwarded++;
        else summary.failed++;
        const tag = `→ ${r.status} ${r.statusText} (${r.durationMs} ms)`;
        o.stdout(`${head} ${okish ? p.green(tag) : p.red(tag)}`);
        await safeAck(platform, session, frame.id, { status_code: r.status, duration_ms: r.durationMs, headers: frame.headers, ...manual }, o.stderr);
      } else {
        summary.failed++;
        o.stdout(`${head} ${p.red(`→ failed: ${r.error}`)}`);
        await safeAck(platform, session, frame.id, { error: r.error, duration_ms: r.durationMs, headers: frame.headers, ...manual }, o.stderr);
      }
      printBody(o, frame);
    }
  } catch (e) {
    if (e instanceof SSEConnectError) throw new ListenError(e.message, e.status === 401 ? 2 : 1);
    if (!o.signal?.aborted) throw e;
  }
  return summary;
}

function printBody(o: ListenOptions, frame: Frame) {
  const indent = "          ";
  o.stdout(`${indent}X-Elapse-Signature: ${frame.headers["X-Elapse-Signature"] ?? ""}`);
  const body = prettyJson(frame.raw_body, o.compact);
  for (const line of body.split("\n")) o.stdout(`${indent}${line}`);
}

/** FR-CLI-014: an ack that fails is retried once, then dropped (the platform expires the row). */
async function safeAck(platform: Platform, session: CliSession, id: string, body: Record<string, unknown>, stderr: (l: string) => void) {
  for (let i = 0; i < 2; i++) {
    try {
      await platform.ack(session, id, body);
      return;
    } catch (e) {
      if (i === 1) stderr(`Could not report ${shortId(id)} back to Elapse: ${(e as Error).message}`);
    }
  }
}
