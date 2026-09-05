/** Per-chain deployment record from `contracts/deployments/<chainId>.json`, copied by `pnpm sync-deployments`. */
import testnet from "../../deployments/10143.json" with { type: "json" };
import type { Address } from "viem";

export interface Deployment {
  chainId: number;
  factory: Address;
  implementation: Address;
  treasury: Address;
  feeBps: number;
  ausd: Address;
  ausdDecimals: number;
  mockUsd: Address;
  deployedAtBlock: number;
}

const byChain: Record<number, Deployment> = { 10143: testnet as Deployment };

export function deploymentFor(chainId: number): Deployment {
  const d = byChain[chainId];
  if (!d) throw new Error(`No deployment record for chain ${chainId}`);
  return d;
}

/** Test mode (10143) escrows MockUSD; live (143) escrows AUSD (Undecided 4, decided 2026-09-05). */
export function escrowTokenFor(chainId: number): Address {
  const d = deploymentFor(chainId);
  return chainId === 143 ? d.ausd : d.mockUsd;
}
