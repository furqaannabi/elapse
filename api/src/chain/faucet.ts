/**
 * The testnet faucet wallet (FR-API-147, ADR 2026-10-02). A separate key from the relayer's, which
 * holds MON for gas and never AUSD (ADR 2026-09-04). `FAUCET_PRIVATE_KEY` is read from the
 * environment once and never logged.
 *
 * BR-API-009: the faucet can never move real money. Its chain and token are constants here, not
 * configuration — no environment variable can point it at mainnet — and the client refuses to send
 * if the RPC it is given answers for any other chain. Without the key it does not exist at all.
 *
 * `FaucetClient` is the seam: production uses viem against `MONAD_RPC_URL`; tests inject a fake.
 */
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Monad testnet. Never configuration (BR-API-009). */
export const FAUCET_CHAIN_ID = 10143;
/** Testnet AUSD, the token every test-mode session escrows. Never configuration (BR-API-009). */
export const FAUCET_TOKEN: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
/** One drop: 15 AUSD at six decimals — Acme GPU's one-hour cap is $14.40 (ADR 2026-10-02). */
export const FAUCET_DROP_UNITS = 15_000_000n;

export interface FaucetClient {
  readonly address: Address;
  /** The wallet's testnet AUSD, in base units. */
  balanceOf(wallet: Address): Promise<bigint>;
  /** Sends `units` of testnet AUSD; resolves with the hash once broadcast. */
  transfer(to: Address, units: bigint): Promise<Hex>;
}

/** Throws unless `chainId` is Monad testnet: the last line between the faucet and real money. */
export function assertFaucetChain(chainId: number): void {
  if (chainId !== FAUCET_CHAIN_ID) {
    throw new Error(`The faucet sends on Monad testnet (${FAUCET_CHAIN_ID}) only; this RPC answers for chain ${chainId}.`);
  }
}

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

function viemFaucetClient(privateKey: Hex, rpcUrl: string): FaucetClient {
  const chain = defineChain({
    id: FAUCET_CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const account = privateKeyToAccount(privateKey);
  const reader = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  let checked = false;
  return {
    address: account.address,
    balanceOf: (who) => reader.readContract({ address: FAUCET_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }),
    async transfer(to, units) {
      if (!checked) {
        assertFaucetChain(await reader.getChainId());
        checked = true;
      }
      return wallet.writeContract({ account, chain, address: FAUCET_TOKEN, abi: erc20, functionName: "transfer", args: [to, units] });
    },
  };
}

let current: FaucetClient | null | undefined;

/** The process-wide faucet, or `null` when `FAUCET_PRIVATE_KEY` is unset: then there is no faucet. */
export function faucetClient(): FaucetClient | null {
  if (current !== undefined) return current;
  const raw = process.env.FAUCET_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.MONAD_RPC_URL;
  if (!raw || !rpcUrl) return (current = null);
  // `cast wallet new` prints the key with 0x; a decrypted keystore prints it without.
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return (current = null);
  return (current = viemFaucetClient(key, rpcUrl));
}

/** Tests swap in a fake; `null` means "no faucet", as an unset key does. */
export function setFaucetClient(client: FaucetClient | null): void {
  current = client;
}
