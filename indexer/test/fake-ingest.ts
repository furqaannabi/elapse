import { vi } from "vitest";

export type IngestCall = { url: string; headers: Record<string, string>; body: unknown };

/**
 * Replaces global fetch with a programmable ingest endpoint. The Effect reads
 * `globalThis.fetch` at call time, so tests never touch the network.
 * `responses` is consumed in order; the last one repeats. Pass `only` to script one event name.
 */
export function installFakeIngest(responses: Array<number | Error> = [200], only?: string) {
  const calls: IngestCall[] = [];
  let i = 0;
  process.env.ENVIO_INGEST_URL = "http://ingest.test/internal/ingest";
  process.env.ENVIO_INGEST_TOKEN = "ingest-test-token";
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { event_name?: string }) : undefined;
    calls.push({
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body,
    });
    // `only` scopes the scripted responses to one event name; every other event succeeds.
    if (only && body?.event_name !== only) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r === 200 ? { ok: true } : { error: "x" }), { status: r });
  });
  return calls;
}
