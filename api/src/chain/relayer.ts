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
}

export interface ChainClient {
  readonly address: Address;
  readPermitDomain(chainId: number, token: Address): Promise<PermitDomain>;
  readNonce(chainId: number, token: Address, owner: Address): Promise<bigint>;
  readBalance(chainId: number, token: Address, owner: Address): Promise<bigint>;
  /** Testnet only: mint MockUSD so a test checkout never needs a faucet (FR-API-032). Waits for the receipt. */
  mintMock(chainId: number, token: Address, to: Address, amount: bigint): Promise<Hex>;
  /** Submits `StreamFactory.createWithPermit`; resolves with the tx hash as soon as it is broadcast. */
  createWithPermit(args: CreateWithPermitArgs): Promise<Hex>;
  /** Per-stream replay nonce for `cancelFor` (FR-CON-017). */
  readCancelNonce(chainId: number, stream: Address): Promise<bigint>;
  /** Submits `StreamFactory.settleBatch(streams)` (FR-CON-033); one bad stream never blocks the batch. */
  settleBatch(chainId: number, streams: Address[]): Promise<Hex>;
  /** Submits `AccrualStream.cancel()` as the factory keeper (FR-CON-054, merchant-initiated cancel). */
  cancel(chainId: number, stream: Address): Promise<Hex>;
  /** Submits `AccrualStream.cancelFor(deadline, signature)`; resolves with the tx hash at broadcast. */
  cancelFor(chainId: number, stream: Address, deadline: bigint, signature: Hex): Promise<Hex>;
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
    async mintMock(chainId, token, to, amount) {
      assertChain(chainId);
      if (chainId === 143) throw new Error("mint is testnet-only");
      const hash = await wallet.writeContract({ account, chain, address: token, abi: permitTokenAbi, functionName: "mint", args: [to, amount] });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    async createWithPermit(a) {
      assertChain(a.chainId);
      const { factory } = deploymentFor(a.chainId);
      return wallet.writeContract({
        account,
        chain,
        address: factory,
        abi: factoryAbi,
        functionName: "createWithPermit",
        args: [a.merchant, a.subscriber, a.token, a.ratePerSecond, a.maxEscrow, a.deadline, a.v, a.r, a.s],
      });
    },
    async readCancelNonce(chainId, stream) {
      assertChain(chainId);
      return publicClient.readContract({ address: stream, abi: streamAbi, functionName: "cancelNonce" });
    },
    async settleBatch(chainId, streams) {
      assertChain(chainId);
      const { factory } = deploymentFor(chainId);
      return wallet.writeContract({ account, chain, address: factory, abi: factoryAbi, functionName: "settleBatch", args: [streams] });
    },
    async cancel(chainId, stream) {
      assertChain(chainId);
      return wallet.writeContract({ account, chain, address: stream, abi: streamAbi, functionName: "cancel", args: [] });
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
