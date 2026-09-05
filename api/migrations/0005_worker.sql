-- Week 2, slice 6: worker (worker FRD, signed 2026-09-05; ADR 2026-09-05 worker-in-api).
ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('queued', 'retrying', 'succeeded', 'exhausted', 'skipped'));
ALTER TABLE deliveries ADD CONSTRAINT deliveries_event_endpoint_unique UNIQUE (event_id, endpoint_id);

-- A crashed attempt is recorded with the same n as its retry (FR-WRK-015), so n is not unique.
ALTER TABLE delivery_attempts DROP CONSTRAINT delivery_attempts_delivery_id_n_key;
ALTER TABLE delivery_attempts ADD COLUMN manual boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_attempts ADD COLUMN actor text;
CREATE INDEX delivery_attempts_delivery_idx ON delivery_attempts (delivery_id, sent_at DESC);

-- Time-based auto-disable (FR-WRK-050).
ALTER TABLE webhook_endpoints ADD COLUMN disabled_reason text;
ALTER TABLE webhook_endpoints ADD COLUMN failing_since timestamptz;
ALTER TABLE webhook_endpoints ADD COLUMN warned_24h_at timestamptz;

-- Dashboard bell (API FR-API-109); written here by the worker, later by ingest too.
CREATE TABLE notifications (
  id           text PRIMARY KEY,
  merchant_id  text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode     boolean NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('endpoint_failing', 'endpoint_exhausted', 'key_expiring', 'secret_expiring', 'payment_failed', 'first_delivery_succeeded')),
  summary      text NOT NULL,
  target_id    text,
  emailed_at   timestamptz,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_merchant_idx ON notifications (merchant_id, livemode, read_at, created_at DESC);
