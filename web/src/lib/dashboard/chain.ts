/**
 * Chain references for the merchant side: understated, one short id and
 * one external link (BR-DSH-005). No addresses or raw tx data elsewhere.
 */
export const EXPLORER = {
  test: "https://testnet.monadexplorer.com",
  live: "https://monadexplorer.com",
} as const;

export function txUrl(txId: string, livemode: boolean): string {
  return `${livemode ? EXPLORER.live : EXPLORER.test}/tx/${txId}`;
}
