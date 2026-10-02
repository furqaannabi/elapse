-- FR-API-148 (ADR 2026-10-02): every testnet faucet drop, so the limits can be counted.
--
-- One row per drop actually sent: a refusal or a transfer that failed writes nothing, so it never
-- counts against anyone. The three limits are rolling 24-hour counts — per wallet, per IP, and
-- across the faucet — hence an index for each. The wallet is stored lower-cased.
CREATE TABLE IF NOT EXISTS faucet_drops (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  ip TEXT,
  amount_units NUMERIC(78, 0) NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faucet_drops_wallet_created ON faucet_drops (wallet_address, created_at);
CREATE INDEX IF NOT EXISTS faucet_drops_ip_created ON faucet_drops (ip, created_at);
CREATE INDEX IF NOT EXISTS faucet_drops_created ON faucet_drops (created_at);
