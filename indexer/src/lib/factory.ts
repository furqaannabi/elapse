import type { Factory, EvmOnEventContext } from "envio";
import { deployment } from "./deployments.js";

/**
 * Loads the `Factory` singleton for this factory address (FR-IDX-013), seeding fee parameters
 * from the deployment record because the constructor emits no `FeeChanged`.
 */
export async function getOrCreateFactory(context: EvmOnEventContext, address: string, chainId: number): Promise<Factory> {
  const d = deployment(chainId);
  return context.Factory.getOrCreate({
    id: address,
    chainId,
    streamCount: 0,
    activeCount: 0,
    totalSettled: 0n,
    totalFees: 0n,
    feeBps: d.feeBps,
    treasury: d.treasury.toLowerCase(),
  });
}
