import { STATUS_CODES } from "node:http";

export const CLI_VERSION = "0.1.0";

export type ForwardResult =
  | { ok: true; status: number; statusText: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * FR-CLI-013/014: POST the platform's exact bytes and its `X-Elapse-*` headers
 * to the merchant's local URL. Never parses or re-serialises the body, never
 * re-signs (BR-CLI-001). Timeout 10 s like the worker (BR-CLI-006). Failures
 * are values, not exceptions, so `listen` keeps going.
 */
export async function forward(url: string, rawBody: string, headers: Record<string, string>, o: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<ForwardResult> {
  const timeoutMs = o.timeoutMs ?? 10_000;
  const started = performance.now();
  const h: Record<string, string> = { "Content-Type": "application/json", "User-Agent": `elapse-cli/${CLI_VERSION}` };
  for (const [k, v] of Object.entries(headers)) if (/^x-elapse-/i.test(k) || k.toLowerCase() === "content-type") h[k] = v;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (o.fetchImpl ?? fetch)(url, { method: "POST", headers: h, body: rawBody, signal: controller.signal });
    await res.arrayBuffer().catch(() => undefined);
    return { ok: true, status: res.status, statusText: STATUS_CODES[res.status] ?? "", durationMs: Math.round(performance.now() - started) };
  } catch (e) {
    const durationMs = Math.round(performance.now() - started);
    if (controller.signal.aborted) return { ok: false, error: `timeout after ${timeoutMs} ms`, durationMs };
    return { ok: false, error: errorCode(e), durationMs };
  } finally {
    clearTimeout(timer);
  }
}

function errorCode(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; code?: string; message?: string };
  return err.cause?.code ?? err.code ?? err.cause?.message ?? err.message ?? "unknown error";
}
