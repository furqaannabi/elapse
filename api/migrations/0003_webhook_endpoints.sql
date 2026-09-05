-- Week 2, slice 4. FR-API-060/061/062/105.
CREATE TABLE webhook_endpoints (
  id                          text PRIMARY KEY,
  merchant_id                 text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode                    boolean NOT NULL,
  url                         text NOT NULL,
  events                      text[] NOT NULL,
  disabled                    boolean NOT NULL DEFAULT false,
  secret_enc                  bytea NOT NULL,          -- AES-256-GCM under WEBHOOK_SECRET_KEK
  previous_secret_enc         bytea,                   -- during a roll's grace window (FR-WRK-040)
  previous_secret_expires_at  timestamptz,
  consecutive_failures        integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_prev_pair CHECK ((previous_secret_enc IS NULL) = (previous_secret_expires_at IS NULL))
);
CREATE INDEX webhook_endpoints_merchant_idx ON webhook_endpoints (merchant_id, livemode, created_at DESC);
