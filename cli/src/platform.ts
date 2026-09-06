import { Elapse } from "@elapse/sdk";
import { CLI_VERSION } from "./forward";

/**
 * The CLI's calls to the platform. The frozen SDK surface covers products and
 * checkout sessions (FR-CLI-022) and validates a key at `login` (FR-CLI-002);
 * the CLI-only routes (sessions, ack, events list/resend — API FR-API-130–133,
 * FR-API-063) are not in the SDK, so they go through one small `fetch` helper
 * here. No second HTTP library (FR-CLI-031).
 */

export interface CliSession {
  id: string;
  endpoint_id: string;
  signing_secret: string;
  stream_url: string;
  livemode: boolean;
  merchant_name: string;
}

export interface EventSummary {
  id: string;
  type: string;
  created: number;
  pending_webhooks: number;
  livemode: boolean;
}

export interface DeliverySummary {
  id: string;
  status: string;
  endpoint: string;
  endpoint_url: string;
  resend_requested?: boolean;
}

export class PlatformError extends Error {
  constructor(public readonly status: number, public readonly type: string, message: string) {
    super(message);
  }
}

export class Platform {
  readonly sdk: Elapse;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  constructor(public readonly baseUrl: string, key: string, fetchImpl?: typeof fetch) {
    this.#key = key;
    this.#fetch = fetchImpl ?? fetch;
    this.sdk = new Elapse({ secretKey: key, baseUrl, maxRetries: 1 });
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#key}`, Accept: "application/json", "User-Agent": `elapse-cli/${CLI_VERSION}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await this.#fetch(`${this.baseUrl}${path}`, init);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const e = parsed?.error ?? {};
      throw new PlatformError(res.status, e.type ?? "api_error", e.message ?? `${res.status} from ${path}`);
    }
    return parsed as T;
  }

  openSession(): Promise<CliSession> {
    return this.request<CliSession>("POST", "/v1/cli/sessions");
  }

  streamUrl(session: CliSession): string {
    return `${this.baseUrl}${session.stream_url}`;
  }

  ack(session: CliSession, deliveryId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `/v1/cli/sessions/${session.id}/deliveries/${deliveryId}/ack`, body);
  }

  listEvents(o: { limit: number; type?: string | undefined }): Promise<{ data: EventSummary[] }> {
    const q = new URLSearchParams({ limit: String(o.limit) });
    if (o.type) q.set("type", o.type);
    return this.request("GET", `/v1/events?${q}`);
  }

  resendEvent(id: string): Promise<{ data: DeliverySummary[] }> {
    return this.request("POST", `/v1/events/${encodeURIComponent(id)}/resend`);
  }

  /** `login` validation: the cheapest frozen call. */
  async validate(): Promise<void> {
    await this.sdk.products.list({ limit: 1 });
  }
}
