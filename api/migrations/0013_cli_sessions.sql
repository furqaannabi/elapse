-- FR-API-130/134: one persistent CLI endpoint per merchant per mode (ADR 2026-09-06).
ALTER TABLE webhook_endpoints ADD COLUMN kind text NOT NULL DEFAULT 'http' CHECK (kind IN ('http', 'cli'));
ALTER TABLE webhook_endpoints ADD COLUMN cli_connected_until timestamptz;   -- kind = cli: matched by createEvent only while in the future
CREATE UNIQUE INDEX webhook_endpoints_cli_one_per_mode ON webhook_endpoints (merchant_id, livemode) WHERE kind = 'cli';
CREATE TABLE cli_sessions (
  id            text PRIMARY KEY,                 -- clis_…
  merchant_id   text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode      boolean NOT NULL,
  endpoint_id   text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);
CREATE INDEX cli_sessions_merchant_idx ON cli_sessions (merchant_id, livemode, created_at DESC);
