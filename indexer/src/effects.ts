/**
 * `postIngest` — the one side effect in the indexer (indexer FRD FR-IDX-020..023, FR-IDX-025).
 *
 * POSTs one chain log to the platform's `POST /internal/ingest` (API FRD FR-API-070) with the
 * shared `ENVIO_INGEST_TOKEN`. `cache: false` because delivery must never be memoised to disk;
 * `rateLimit: false` because the target is our own API (ADR 2026-09-05). Envio still dedupes
 * identical calls inside one run, which is what makes the preload double-run harmless.
 *
 * Retries 5xx and network errors three times (1 s, 4 s, 16 s), fails fast on 4xx, and never
 * throws: a broken platform must not halt indexing (BR-IDX-006).
 */
import { createEffect, S } from "envio";

/** Money movement derived from one log (FR-IDX-014). Amounts are decimal strings in token base units. */
export const ledgerRowSchema = S.schema({
  kind: S.union(["deposit", "settlement", "fee", "refund"]),
  amount: S.string,
  from: S.string,
  to: S.string,
});

export const ingestBodySchema = S.schema({
  chain_id: S.number,
  block_number: S.number,
  block_hash: S.string,
  block_timestamp: S.number,
  tx_hash: S.string,
  log_index: S.number,
  address: S.string,
  event_name: S.string,
  args: S.record(S.string),
  ledger: S.array(ledgerRowSchema),
});
export type IngestBody = S.Output<typeof ingestBodySchema>;

export const ingestResultSchema = S.schema({
  status: S.union(["sent", "duplicate", "failed"]),
  attempts: S.number,
  error: S.optional(S.string),
});
export type IngestResult = S.Output<typeof ingestResultSchema>;

export const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
const REQUEST_TIMEOUT_MS = 10_000;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
declare global {
  // eslint-disable-next-line no-var
  var __elapseIngestSleep: Sleep | undefined;
}
/** Test hook: replace the backoff sleeper. Global because Envio loads handlers in its own module graph. */
export function _setSleep(fn: Sleep | undefined) {
  globalThis.__elapseIngestSleep = fn;
}
const sleep: Sleep = (ms) => (globalThis.__elapseIngestSleep ?? realSleep)(ms);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const postIngest = createEffect(
  {
    name: "postIngest",
    input: ingestBodySchema,
    output: ingestResultSchema,
    rateLimit: false,
    cache: false,
  },
  async ({ input, context }): Promise<IngestResult> => {
    const url = env("ENVIO_INGEST_URL");
    const token = env("ENVIO_INGEST_TOKEN");
    const body = JSON.stringify(input);
    let lastError = "";
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      try {
        const res = await globalThis.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { duplicate?: boolean };
          return { status: json.duplicate ? "duplicate" : "sent", attempts: attempt, error: undefined };
        }
        lastError = `HTTP ${res.status}`;
        if (res.status < 500) {
          const text = await res.text().catch(() => "");
          context.log.error(`ingest rejected ${input.event_name} ${input.tx_hash}:${input.log_index}: ${lastError} ${text.slice(0, 512)}`);
          return { status: "failed", attempts: attempt, error: lastError };
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined) break;
      context.log.warn(`ingest attempt ${attempt} failed for ${input.event_name} ${input.tx_hash}:${input.log_index} (${lastError}); retrying in ${delay} ms`);
      await sleep(delay);
    }
    context.log.error(`ingest gave up on ${input.event_name} ${input.tx_hash}:${input.log_index}: ${lastError}`);
    return { status: "failed", attempts: RETRY_DELAYS_MS.length + 1, error: lastError };
  },
);
