/**
 * Per-chain deployment record copied from `contracts/deployments/<chainId>.json` by
 * `pnpm sync-abi` (contracts FR-CON-062). The factory constructor emits no `FeeChanged`,
 * so the initial treasury and fee come from here until the first `FeeChanged` log.
 */
import testnet from "../../deployments/10143.json" with { type: "json" };

export type Deployment = {
  chainId: number;
  factory: string;
  treasury: string;
  feeBps: number;
  deployedAtBlock: number;
  ausd: string;
};

const byChain: Record<number, Deployment> = {
  10143: testnet,
};

export function deployment(chainId: number): Deployment {
  const d = byChain[chainId];
  if (!d) throw new Error(`no deployment record for chain ${chainId}; run pnpm sync-abi`);
  return d;
}
