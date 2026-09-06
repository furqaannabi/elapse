/**
 * Server-sent events over `fetch` (FR-CLI-010, FR-CLI-016). No dependency:
 * Node 20's `fetch` body is an async iterable of bytes. `readSSE` reconnects
 * with 1 s → 30 s backoff, sending `Last-Event-ID` so the platform re-sends
 * what was not acked; a 4xx on connect is fatal (bad key, unknown session).
 */

export interface SSEFrame {
  event: string;
  data: string;
  id?: string;
}

/** Parse a byte stream into frames per the WHATWG EventSource algorithm (the parts we need). */
export async function* parseSSE(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<SSEFrame> {
  const decoder = new TextDecoder();
  let buf = "";
  let event = "";
  let id: string | undefined;
  let data: string[] = [];
  const flush = (): SSEFrame | null => {
    if (data.length === 0 && event === "" && id === undefined) return null;
    const frame: SSEFrame = { event: event || "message", data: data.join("\n") };
    if (id !== undefined) frame.id = id;
    event = "";
    id = undefined;
    data = [];
    return frame;
  };
  for await (const chunk of bytes) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
      if (line === "") {
        const f = flush();
        if (f) yield f;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
  }
}

/** FR-CLI-016: 1 s doubling, capped at 30 s. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export interface ReadOptions {
  key: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each reconnect attempt with its number (1-based). */
  onReconnect?: (attempt: number, delayMs: number) => void;
}

export class SSEConnectError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Connect, yield frames, reconnect on drop until `signal` aborts. Throws on a 4xx at connect. */
export async function* readSSE(url: string, o: ReadOptions): AsyncGenerator<SSEFrame> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastId: string | undefined;
  let failures = 0;
  while (!o.signal?.aborted) {
    let res: Response;
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${o.key}`, Accept: "text/event-stream" };
      if (lastId) headers["Last-Event-ID"] = lastId;
      const init: RequestInit = { headers };
      if (o.signal) init.signal = o.signal;
      res = await doFetch(url, init);
    } catch (e) {
      if (o.signal?.aborted) return;
      failures++;
      const delay = backoffMs(failures - 1);
      o.onReconnect?.(failures, delay);
      await sleep(delay);
      continue;
    }
    if (res.status >= 400 && res.status < 500) {
      let message = `${res.status} from the platform`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) message = body.error.message;
      } catch {}
      throw new SSEConnectError(res.status, message);
    }
    if (!res.ok || !res.body) {
      failures++;
      const delay = backoffMs(failures - 1);
      o.onReconnect?.(failures, delay);
      await sleep(delay);
      continue;
    }
    try {
      for await (const frame of parseSSE(res.body as unknown as AsyncIterable<Uint8Array>)) {
        failures = 0;
        if (frame.id) lastId = frame.id;
        yield frame;
      }
    } catch (e) {
      if (o.signal?.aborted) return;
    }
    if (o.signal?.aborted) return;
    failures++;
    const delay = backoffMs(failures - 1);
    o.onReconnect?.(failures, delay);
    await sleep(delay);
  }
}
