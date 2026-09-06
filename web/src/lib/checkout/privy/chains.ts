/**
 * Monad chains for the subscriber's embedded wallet. Privy takes these in the provider
 * config (`supportedChains` / `defaultChain`); there is no dashboard setting for chains.
 * Subscribers never see these names: the UI speaks dollars (BR-CHK-001).
 */
import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } },
  testnet: true,
});

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_MONAD_MAINNET_RPC_URL ?? "https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://monadscan.com" } },
});

/** Test mode runs on 10143 until Week 5; live mode is 143. Chosen per session by the API's `chain_id`. */
export const chainFor = (chainId: number) => (chainId === 143 ? monad : monadTestnet);
