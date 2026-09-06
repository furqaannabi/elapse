import { randomUUID } from "node:crypto";
import { ElapseAPIError, ElapseAuthenticationError, ElapseError, ElapseInvalidRequestError, ElapseRateLimitError } from "./errors";

export const VERSION = "0.1.1";

/** Per-request options accepted as the last argument of every method (FR-SDK-014). */
export interface RequestOptions {
  /** Reused across this call's retries. Generated as a UUID for create/cancel when absent (FR-SDK-013). */
  idempotencyKey?: string;
  /** Overrides the client default (30 s). */
  timeoutMs?: number;
}

export interface TransportConfig {
  secretKey: string;
  baseUrl: string;
  maxRetries: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * The one HTTP path (FR-SDK-010–014). Retries network errors, 429 and 5xx
 * with `500 ms × 2ⁿ ± 25 %` jitter up to `maxRetries`, honouring `Retry-After`
 * on 429. 4xx other than 429 are thrown at once. Non-2xx bodies in the
 * FR-API-082 shape map to the error classes.
 */
export class Transport {
  /** A real private field: `util.inspect` and `console.log` never show it (BR-SDK-002). */
  readonly #cfg: TransportConfig;
  constructor(cfg: TransportConfig) {
    this.#cfg = cfg;
  }

  /** Overridable for tests. */
  _sleep(ms: number): Promise<void> {
    return new Promise((f) => setTimeout(f, ms));
  }

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.#cfg.baseUrl}/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#cfg.secretKey}`,
      "Content-Type": "application/json",
      "User-Agent": `elapse-node/${VERSION}`,
      Accept: "application/json",
    };
    if (method === "POST") headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();
    const timeoutMs = opts.timeoutMs ?? this.#cfg.timeoutMs;
    const payload = body === undefined ? undefined : JSON.stringify(body);

    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
        if (payload !== undefined) init.body = payload;
        res = await (this.#cfg.fetchImpl ?? fetch)(url, init);
      } catch (e) {
        const err = networkError(e);
        if (attempt < this.#cfg.maxRetries) {
          await this._sleep(backoff(attempt++));
          continue;
        }
        throw err;
      }

      const requestId = res.headers.get("request-id") ?? undefined;
      const text = await res.text();

      if (res.ok) {
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ElapseAPIError("Invalid JSON received from the Elapse API.", { status: res.status, ...(requestId ? { requestId } : {}) });
        }
      }

      const err = mapError(res.status, text, requestId, res.headers.get("retry-after"));
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.#cfg.maxRetries) {
        const ra = err instanceof ElapseRateLimitError && err.retryAfter !== undefined ? err.retryAfter * 1000 : undefined;
        await this._sleep(ra ?? backoff(attempt));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

/** 500 ms × 2ⁿ with ±25 % jitter (Undecided 3). */
export function backoff(n: number): number {
  const base = 500 * 2 ** n;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function networkError(e: unknown): ElapseAPIError {
  const name = e instanceof Error ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new ElapseAPIError("Request timed out.", { code: "timeout" });
  const msg = e instanceof Error ? e.message : String(e);
  return new ElapseAPIError(`Network error: ${msg}`, { code: "network_error" });
}

function mapError(status: number, text: string, requestId: string | undefined, retryAfter: string | null): ElapseError {
  let type: string | undefined;
  let message = `Request failed with status ${status}.`;
  let code: string | undefined;
  let param: string | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { type?: string; message?: string; code?: string; param?: string } };
    if (parsed?.error) {
      type = parsed.error.type;
      message = parsed.error.message ?? message;
      code = parsed.error.code;
      param = parsed.error.param;
    }
  } catch {
    // unparseable body: fall through with the status message
  }
  const fields = {
    status,
    ...(type ? { type } : {}),
    ...(code ? { code } : {}),
    ...(param ? { param } : {}),
    ...(requestId ? { requestId } : {}),
  };
  if (status === 401 || status === 403) return new ElapseAuthenticationError(message, fields);
  if (status === 429) {
    const ra = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    return new ElapseRateLimitError(message, { ...fields, ...(ra !== undefined ? { retryAfter: ra } : {}) });
  }
  if (status >= 400 && status < 500) return new ElapseInvalidRequestError(message, fields);
  return new ElapseAPIError(message, fields);
}
