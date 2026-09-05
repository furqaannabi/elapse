/**
 * Reads the indexer's own view of itself from Envio's GraphQL (indexer FRD FR-IDX-040/042):
 * Hasura's `chain_metadata` for the processed block vs chain head, and the count of
 * `StreamEvent` rows whose ingest did not reach us. Server-side only; the judge panel never
 * talks to Envio (decided 2026-09-05, option b). `INDEXER_GRAPHQL_URL` defaults to the
 * `envio dev` endpoint.
 */
export interface IndexerSnapshot {
  latest_block: number;
  head_block: number;
  /** Unix seconds when the indexer last advanced, if Hasura exposes it; else now. */
  updated_at: number;
  unsent_events: number;
}

export type IndexerReader = (chainId: number) => Promise<IndexerSnapshot>;

const graphqlUrl = () => process.env.INDEXER_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";

const QUERY = `query Status($chain: Int!) {
  chain_metadata(where: { chain_id: { _eq: $chain } }) { latest_processed_block block_height timestamp_caught_up_to_head_or_endblock }
  pending: StreamEvent(where: { chainId: { _eq: $chain }, ingestStatus: { _in: ["pending", "failed"] } }, limit: 1000) { id }
}`;
// Envio's public Hasura role exposes no aggregates, so unsent events are counted from a bounded list (≤ 1000).

export const envioReader: IndexerReader = async (chainId) => {
  const res = await fetch(graphqlUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { chain: chainId } }),
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) throw new Error(`indexer graphql ${res.status}`);
  const json = (await res.json()) as { data?: { chain_metadata?: Array<{ latest_processed_block: number; block_height: number; timestamp_caught_up_to_head_or_endblock?: string | null }>; pending?: Array<{ id: string }> }; errors?: unknown[] };
  const meta = json.data?.chain_metadata?.[0];
  if (!meta) throw new Error("indexer has no chain_metadata for this chain");
  return {
    latest_block: Number(meta.latest_processed_block),
    head_block: Number(meta.block_height),
    updated_at: Math.floor(Date.now() / 1000),
    unsent_events: json.data?.pending?.length ?? 0,
  };
};

let reader: IndexerReader | null = null;
export function indexerReader(): IndexerReader {
  return reader ?? envioReader;
}
/** Test hook. */
export function setIndexerReader(r: IndexerReader | null): void {
  reader = r;
}
