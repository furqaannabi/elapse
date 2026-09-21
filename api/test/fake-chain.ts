import type { Address, Hex } from "viem";
import type { ChainClient, CreateWithPermitArgs, StreamLog, StreamState } from "../src/chain/relayer";

/** In-memory chain: nonces, balances, and a log of every write. */
export function fakeChain(opts: { chainId?: number; balances?: Record<string, bigint>; nativeBalances?: Record<string, bigint> } = {}) {
  const chainId = opts.chainId ?? 10143;
  const balances = new Map<string, bigint>(Object.entries(opts.balances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const nonces = new Map<string, bigint>();
  const creates: CreateWithPermitArgs[] = [];
  const cancels: Array<{ stream: string; deadline: bigint; signature: string }> = [];
  const pauses: Array<{ stream: string; deadline: bigint; signature: string }> = [];
  const resumes: Array<{ stream: string; deadline: bigint; signature: string }> = [];
  const keeperCancels: string[] = [];
  const keeperStarts: string[] = [];
  /** FR-API-141/142: pauses and resumes the keeper submits with no signature (contracts FR-CON-074). */
  const keeperPauses: string[] = [];
  const keeperResumes: string[] = [];
  const settleBatches: Array<{ chainId: number; streams: string[]; gas: bigint }> = [];
  /** Per-stream direct settle estimate, or an Error to make the direct call revert (FR-WRK-072). Default 210_000. */
  const settleEstimates = new Map<string, bigint | Error>();
  /** Per-stream on-chain state for reconcile (FR-WRK-073); an Error makes the read fail. Default: active. */
  const streamStates = new Map<string, StreamState | Error>();
  const streamLogs = new Map<string, StreamLog[]>();
  const logQueries: Array<{ chainId: number; stream: string; fromBlock: number }> = [];
  const state = { failNextSettle: null as Error | null, receiptLogs: null as number | null, failNextNativeRead: null as Error | null, failNextCancel: null as Error | null };
  const nativeBalances = new Map<string, bigint>(Object.entries(opts.nativeBalances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const cancelNonces = new Map<string, bigint>();
  let n = 0;
  // Own hash space (`0xfa…`): the ingest fixtures count from 0x…1 too, and a shared value would deduplicate a log.
  const hash = () => ("0xfa" + (++n).toString(16).padStart(62, "0")) as Hex;
  const client: ChainClient = {
    address: "0xaf1444abf40afc91bcb4a6793765553c6bccea0d",
    async readPermitDomain(_c, token) {
      return { name: "AUSD", version: "1", chainId, verifyingContract: token };
    },
    async readNonce(_c, _t, owner) {
      return nonces.get(owner.toLowerCase()) ?? 0n;
    },
    async readBalance(_c, _t, owner) {
      return balances.get(owner.toLowerCase()) ?? 0n;
    },
    async readNativeBalance(_c, owner) {
      if (state.failNextNativeRead) {
        const e = state.failNextNativeRead;
        state.failNextNativeRead = null;
        throw e;
      }
      return nativeBalances.get(owner.toLowerCase()) ?? 0n;
    },
    async createWithPermit(args) {
      creates.push(args);
      nonces.set(args.subscriber.toLowerCase(), (nonces.get(args.subscriber.toLowerCase()) ?? 0n) + 1n);
      return hash();
    },
    async readRelayNonce(_c, stream) {
      return cancelNonces.get(stream.toLowerCase()) ?? 0n;
    },
    async estimateSettle(_c, stream) {
      const e = settleEstimates.get(stream.toLowerCase()) ?? 210_000n;
      if (e instanceof Error) throw e;
      return e;
    },
    async settleBatch(chainId, streams, gas) {
      if (state.failNextSettle) {
        const e = state.failNextSettle;
        state.failNextSettle = null;
        throw e;
      }
      settleBatches.push({ chainId, streams: streams.map((s) => s.toLowerCase()), gas });
      return hash();
    },
    async receiptLogCount() {
      return state.receiptLogs ?? 1;
    },
    async readStreamState(_c, stream) {
      const st = streamStates.get(stream.toLowerCase()) ?? { status: 1, merchant: "0x1111111111111111111111111111111111111111", subscriber: "0x2222222222222222222222222222222222222222", treasury: "0xaf1444abf40afc91bcb4a6793765553c6bccea0d", settledSeconds: 0n };
      if (st instanceof Error) throw st;
      return st;
    },
    async readStreamLogs(chainId, stream, fromBlock) {
      logQueries.push({ chainId, stream: stream.toLowerCase(), fromBlock: Number(fromBlock) });
      return streamLogs.get(stream.toLowerCase()) ?? [];
    },
    async cancel(_c, stream) {
      if (state.failNextCancel) {
        const e = state.failNextCancel;
        state.failNextCancel = null;
        throw e;
      }
      keeperCancels.push(stream.toLowerCase());
      return hash();
    },
    async start(_c: number, stream: string) {
      keeperStarts.push(stream.toLowerCase());
      return hash();
    },
    async pause(_c: number, stream: string) {
      keeperPauses.push(stream.toLowerCase());
      return hash();
    },
    async resume(_c: number, stream: string) {
      keeperResumes.push(stream.toLowerCase());
      return hash();
    },
    async cancelFor(_c, stream, deadline, signature) {
      cancels.push({ stream: stream.toLowerCase(), deadline, signature });
      cancelNonces.set(stream.toLowerCase(), (cancelNonces.get(stream.toLowerCase()) ?? 0n) + 1n);
      return hash();
    },
  };
  return {
    client, creates, cancels, pauses, resumes, keeperCancels,
    keeperStarts, keeperPauses, keeperResumes, settleBatches, settleEstimates, streamStates, streamLogs, logQueries, balances, nonces, nativeBalances, state,
    set failNextSettle(e: Error | null) {
      state.failNextSettle = e;
    },
    /** Makes the next keeper `cancel()` throw, for the FR-WRK-075 sweep's batch-resilience test. */
    set failNextCancel(e: Error | null) {
      state.failNextCancel = e;
    },
    /** Logs the next settle receipt reports; 0 is the drain signature (FR-WRK-072). */
    set receiptLogs(n: number | null) {
      state.receiptLogs = n;
    },
    setNonce: (a: Address, v: bigint) => nonces.set(a.toLowerCase(), v),
    setRelayNonce: (s: string, v: bigint) => cancelNonces.set(s.toLowerCase(), v),
  };
}
