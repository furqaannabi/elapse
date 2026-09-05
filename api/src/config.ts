/**
 * Process configuration, read once. Everything here is non-secret or a
 * reference to a secret held in the environment; nothing is logged.
 * Test mode = Monad testnet 10143 with MockUSD, live = 143 with AUSD (Undecided 4).
 */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** AUSD and MockUSD are both 6-decimal tokens (contracts README, Tokens table). */
  tokenDecimals: Number(process.env.TOKEN_DECIMALS ?? 6),
  chains: {
    test: 10143,
    live: 143,
  },
  checkoutBaseUrl: process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000",
} as const;

export function chainIdFor(livemode: boolean): number {
  return livemode ? config.chains.live : config.chains.test;
}
