/**
 * The Elapse relayer (ADR 2026-09-04): the only party that opens a stream. It holds MON for gas,
 * never AUSD, and can move a subscriber's money only inside a permit they signed for exactly
 * `maxEscrow`. `RELAYER_PRIVATE_KEY` is read from the environment once and never logged.
 *
 * `ChainClient` is the seam: production uses viem against `MONAD_RPC_URL`; tests inject a fake.
 */
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi, permitTokenAbi, streamAbi } from "./abi";
import { deploymentFor } from "./deployments";
import type { PermitDomain } from "./permit";

export interface CreateWithPermitArgs {
  chainId: number;
  merchant: Address;
  subscriber: Address;
  token: Address;
  ratePerSecond: bigint;
  maxEscrow: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
  /** FR-CON-019: fund the stream but leave it Created, for merchant-started metering. */
  noStart?: boolean;
}

export interface ChainClient {
  readonly address: Address;
  readPermitDomain(chainId: number, token: Address): Promise<PermitDomain>;
  readNonce(chainId: number, token: Address, owner: Address): Promise<bigint>;
  readBalance(chainId: number, token: Address, owner: Address): Promise<bigint>;
  /** Native MON balance in wei, for the relayer gas sample (worker FR-WRK-074). */
  readNativeBalance(chainId: number, owner: Address): Promise<bigint>;
  /** Submits `StreamFactory.createWithPermit`; resolves with the tx hash as soon as it is broadcast. */
  createWithPermit(args: CreateWithPermitArgs): Promise<Hex>;
  /** Per-stream replay nonce for `cancelFor` (FR-CON-017). */
  readRelayNonce(chainId: number, stream: Address): Promise<bigint>;
  /**
   * Gas for `settle()` called directly on one stream (FR-WRK-072). Rejects when the call would
   * revert; that is the honest signal the factory's try/catch hides.
   */
  estimateSettle(chainId: number, stream: Address): Promise<bigint>;
  /** Submits `StreamFactory.settleBatch(streams)` (FR-CON-033) with the given gas limit; one bad stream never blocks the batch. */
  settleBatch(chainId: number, streams: Address[], gas: bigint): Promise<Hex>;
  /** Waits for a transaction and reports how many logs it emitted; zero for a non-empty batch is the drain signature (FR-WRK-072). */
  receiptLogCount(chainId: number, hash: Hex): Promise<number>;
  /** The stream's status enum (0 Created, 1 Active, 2 Paused, 3 Canceled) and the parties its ledger rows name (FR-WRK-073). */
  readStreamState(chainId: number, stream: Address): Promise<StreamState>;
  /**
   * The stream's own `Settled` and `StreamCanceled` logs, decoded the way the indexer serialises
   * them (FR-WRK-073). Scans newest-first in RPC-sized windows down to `fromBlock`, and stops
   * early once a `StreamCanceled` is in hand and the `Settled` seconds add up to `settledSeconds`.
   */
  readStreamLogs(chainId: number, stream: Address, fromBlock: bigint, expect: { settledSeconds: bigint }): Promise<StreamLog[]>;
  /** Submits `AccrualStream.cancel()` as the factory keeper (FR-CON-054, merchant-initiated cancel). */
  cancel(chainId: number, stream: Address): Promise<Hex>;

  /** FR-API-049: start a funded stream as keeper, on the merchant's behalf. */
  start(chainId: number, stream: Address): Promise<Hex>;
  /** FR-API-141: pause as keeper, so a merchant can bill only while its resource works (FR-CON-074). */
  pause(chainId: number, stream: Address): Promise<Hex>;
  /** FR-API-142: resume as keeper (FR-CON-074). */
  resume(chainId: number, stream: Address): Promise<Hex>;
  /** Submits `AccrualStream.cancelFor(deadline, signature)`; resolves with the tx hash at broadcast. */
  cancelFor(chainId: number, stream: Address, deadline: bigint, signature: Hex): Promise<Hex>;
}

export interface StreamState {
  status: number;
  merchant: Address;
  subscriber: Address;
  treasury: Address;
  /** Whole seconds the chain has settled so far: tells a log scan when it has everything. */
  settledSeconds: bigint;
}

/** Monad's public RPC limits `eth_getLogs` to 100 blocks; mainnet endpoints may allow more. */
export const LOG_WINDOW_BLOCKS = BigInt(process.env.LOG_WINDOW_BLOCKS ?? 100);
const LOG_MAX_WINDOWS = Number(process.env.LOG_MAX_WINDOWS ?? 5000);

/** One decoded log in the ingest body's shape (minus `ledger`, which the caller derives). */
export interface StreamLog {
  event_name: "Settled" | "StreamCanceled";
  args: Record<string, string>;
  block_number: number;
  block_hash: string;
  block_timestamp: number;
  tx_hash: string;
  log_index: number;
}

const monadChain = (chainId: number, rpcUrl: string) =>
  defineChain({
    id: chainId,
    name: chainId === 143 ? "Monad" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

/** viem-backed client. Constructed lazily so tests and the worker never touch RPC. */
export function viemChainClient(env: { privateKey: Hex; rpcUrl: string; chainId: number }): ChainClient {
  const chain = monadChain(env.chainId, env.rpcUrl);
  const account = privateKeyToAccount(env.privateKey);
  const publicClient: PublicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const wallet: WalletClient = createWalletClient({ account, chain, transport: http(env.rpcUrl) });
  const assertChain = (chainId: number) => {
    if (chainId !== env.chainId) throw new Error(`Relayer is configured for chain ${env.chainId}, got ${chainId}`);
  };

  return {
    address: account.address,
    async readPermitDomain(chainId, token) {
      assertChain(chainId);
      try {
        const [, name, version, cid, verifyingContract] = await publicClient.readContract({ address: token, abi: permitTokenAbi, functionName: "eip712Domain" });
        return { name, version, chainId: Number(cid), verifyingContract };
      } catch {
        // Tokens predating ERC-5267: OpenZeppelin's ERC20Permit uses version "1".
        const name = await publicClient.readContract({ address: token, abi: permitTokenAbi, functionName: "name" });
        return { name, version: "1", chainId, verifyingContract: token };
      }
    },
    async readNonce(chainId, token, owner) {
      assertChain(chainId);
      return publicClient.readContract({ address: token, abi: permitTokenAbi, functionName: "nonces", args: [owner] });
    },
    async readBalance(chainId, token, owner) {
      assertChain(chainId);
      return publicClient.readContract({ address: token, abi: permitTokenAbi, functionName: "balanceOf", args: [owner] });
    },
    async readNativeBalance(chainId, owner) {
      assertChain(chainId);
      return publicClient.getBalance({ address: owner });
    },
    async createWithPermit(a) {
      assertChain(a.chainId);
      const { factory } = deploymentFor(a.chainId);
      return wallet.writeContract({
        account,
        chain,
        address: factory,
        abi: factoryAbi,
        functionName: a.noStart ? "createWithPermitNoStart" : "createWithPermit",
        args: [a.merchant, a.subscriber, a.token, a.ratePerSecond, a.maxEscrow, a.deadline, a.v, a.r, a.s],
      });
    },
    async readRelayNonce(chainId, stream) {
      assertChain(chainId);
      return publicClient.readContract({ address: stream, abi: streamAbi, functionName: "relayNonce" });
    },
    async estimateSettle(chainId, stream) {
      assertChain(chainId);
      return publicClient.estimateContractGas({ account, address: stream, abi: streamAbi, functionName: "settle" });
    },
    async settleBatch(chainId, streams, gas) {
      assertChain(chainId);
      const { factory } = deploymentFor(chainId);
      // Never the node's estimate for the batch: the factory's try/catch makes that the out-of-gas amount (FR-WRK-072).
      return wallet.writeContract({ account, chain, address: factory, abi: factoryAbi, functionName: "settleBatch", args: [streams], gas });
    },
    async receiptLogCount(chainId, hash) {
      assertChain(chainId);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      return r.logs.length;
    },
    async readStreamState(chainId, stream) {
      assertChain(chainId);
      const read = <T>(functionName: "status" | "merchant" | "subscriber" | "treasury" | "settledSeconds") => publicClient.readContract({ address: stream, abi: streamAbi, functionName }) as Promise<T>;
      const [status, merchant, subscriber, treasury, settledSeconds] = await Promise.all([read<number>("status"), read<Address>("merchant"), read<Address>("subscriber"), read<Address>("treasury"), read<bigint>("settledSeconds")]);
      return { status: Number(status), merchant, subscriber, treasury, settledSeconds };
    },
    async readStreamLogs(chainId, stream, fromBlock, expect) {
      assertChain(chainId);
      const out: StreamLog[] = [];
      const stamps = new Map<string, number>();
      let seconds = 0n;
      let canceled = false;
      let hi = await publicClient.getBlockNumber();
      for (let i = 0; i < LOG_MAX_WINDOWS && hi >= fromBlock; i++) {
        const lo = hi - LOG_WINDOW_BLOCKS + 1n > fromBlock ? hi - LOG_WINDOW_BLOCKS + 1n : fromBlock;
        const logs = await publicClient.getContractEvents({ address: stream, abi: streamAbi, fromBlock: lo, toBlock: hi });
        for (const l of logs) {
          if (l.eventName !== "Settled" && l.eventName !== "StreamCanceled") continue;
          const key = l.blockHash!;
          if (!stamps.has(key)) stamps.set(key, Number((await publicClient.getBlock({ blockHash: key })).timestamp));
          const args: Record<string, string> = {};
          for (const [k, v] of Object.entries(l.args as Record<string, unknown>)) args[k.replace(/_$/, "")] = typeof v === "bigint" ? v.toString() : String(v);
          if (l.eventName === "Settled") seconds += BigInt(args.seconds ?? "0");
          else canceled = true;
          out.push({ event_name: l.eventName, args, block_number: Number(l.blockNumber), block_hash: key, block_timestamp: stamps.get(key)!, tx_hash: l.transactionHash!, log_index: Number(l.logIndex) });
        }
        if (canceled && seconds >= expect.settledSeconds) break;
        hi = lo - 1n;
      }
      return out.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    },
    async cancel(chainId, stream) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "cancel", args: [] });
    },
    async start(chainId, stream) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "start", args: [] });
    },
    async pause(chainId, stream) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "pause", args: [] });
    },
    async resume(chainId, stream) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "resume", args: [] });
    },
    async cancelFor(chainId, stream, deadline, signature) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "cancelFor", args: [deadline, signature] });
    },
  };
}

let current: ChainClient | null = null;

/** The process-wide client. Built from env on first use; `setChainClient` swaps in a fake for tests. */
export function chainClient(): ChainClient {
  if (current) return current;
  const raw = process.env.RELAYER_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.MONAD_RPC_URL;
  const chainId = Number(process.env.CHAIN_ID ?? 10143);
  if (!raw || !rpcUrl) throw new RelayerUnavailable();
  // `cast wallet decrypt-keystore` prints the key without 0x; viem wants it prefixed.
  const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new RelayerUnavailable();
  current = viemChainClient({ privateKey, rpcUrl, chainId });
  return current;
}

export function setChainClient(client: ChainClient | null): void {
  current = client;
}

export class RelayerUnavailable extends Error {
  constructor() {
    super("The relayer is not configured (RELAYER_PRIVATE_KEY, MONAD_RPC_URL).");
  }
}
