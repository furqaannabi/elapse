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
  /** Where the dashboard is served; magic links point here and it is the only Origin allowed to mutate with a cookie (FR-API-101). */
  dashboardOrigin: (process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, ""),
  email: {
    from: process.env.EMAIL_FROM ?? "Elapse <no-reply@elapse.dev>",
  },
  /** Shared secret the indexer presents on `POST /internal/ingest` (FR-API-070). Unset = route refuses everything. */
  ingestToken: process.env.INGEST_TOKEN ?? "",
} as const;

export function chainIdFor(livemode: boolean): number {
  return livemode ? config.chains.live : config.chains.test;
}
