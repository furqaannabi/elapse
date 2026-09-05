import type { Address, Hex } from "viem";
import type { ChainClient, CreateWithPermitArgs } from "../src/chain/relayer";

/** In-memory chain: nonces, balances, and a log of every write. */
export function fakeChain(opts: { chainId?: number; balances?: Record<string, bigint> } = {}) {
  const chainId = opts.chainId ?? 10143;
  const balances = new Map<string, bigint>(Object.entries(opts.balances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const nonces = new Map<string, bigint>();
  const mints: Array<{ to: string; amount: bigint }> = [];
  const creates: CreateWithPermitArgs[] = [];
  const cancels: Array<{ stream: string; deadline: bigint; signature: string }> = [];
  const keeperCancels: string[] = [];
  const settleBatches: Array<{ chainId: number; streams: string[] }> = [];
  const state = { failNextSettle: null as Error | null };
  const cancelNonces = new Map<string, bigint>();
  let n = 0;
  const hash = () => ("0x" + (++n).toString(16).padStart(64, "0")) as Hex;
  const client: ChainClient = {
    address: "0xaf1444abf40afc91bcb4a6793765553c6bccea0d",
    async readPermitDomain(_c, token) {
      return { name: "Mock USD", version: "1", chainId, verifyingContract: token };
    },
    async readNonce(_c, _t, owner) {
      return nonces.get(owner.toLowerCase()) ?? 0n;
    },
    async readBalance(_c, _t, owner) {
      return balances.get(owner.toLowerCase()) ?? 0n;
    },
    async mintMock(_c, _t, to, amount) {
      mints.push({ to: to.toLowerCase(), amount });
      balances.set(to.toLowerCase(), (balances.get(to.toLowerCase()) ?? 0n) + amount);
      return hash();
    },
    async createWithPermit(args) {
      creates.push(args);
      nonces.set(args.subscriber.toLowerCase(), (nonces.get(args.subscriber.toLowerCase()) ?? 0n) + 1n);
      return hash();
    },
    async readCancelNonce(_c, stream) {
      return cancelNonces.get(stream.toLowerCase()) ?? 0n;
    },
    async settleBatch(chainId, streams) {
      if (state.failNextSettle) {
        const e = state.failNextSettle;
        state.failNextSettle = null;
        throw e;
      }
      settleBatches.push({ chainId, streams: streams.map((s) => s.toLowerCase()) });
      return hash();
    },
    async cancel(_c, stream) {
      keeperCancels.push(stream.toLowerCase());
      return hash();
    },
    async cancelFor(_c, stream, deadline, signature) {
      cancels.push({ stream: stream.toLowerCase(), deadline, signature });
      cancelNonces.set(stream.toLowerCase(), (cancelNonces.get(stream.toLowerCase()) ?? 0n) + 1n);
      return hash();
    },
  };
  return {
    client, mints, creates, cancels, keeperCancels, settleBatches, balances, nonces,
    set failNextSettle(e: Error | null) {
      state.failNextSettle = e;
    },
    setNonce: (a: Address, v: bigint) => nonces.set(a.toLowerCase(), v),
    setCancelNonce: (s: string, v: bigint) => cancelNonces.set(s.toLowerCase(), v),
  };
}
