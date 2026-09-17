/** The block explorer link for a transaction (FR-RCT-023, FR-RCT-031). */
const EXPLORERS: Record<number, string> = {
  10143: "https://testnet.monadscan.com",
  143: "https://monadscan.com",
};

export function explorerUrl(txHash: string, chainId = 10143): string {
  return `${EXPLORERS[chainId] ?? EXPLORERS[10143]}/tx/${txHash}`;
}
