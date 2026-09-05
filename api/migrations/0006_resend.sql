-- Resend (worker FR-WRK-030/031, API FR-API-064): a manual attempt request on a delivery.
ALTER TABLE deliveries ADD COLUMN manual_requested_at timestamptz;
ALTER TABLE deliveries ADD COLUMN manual_requested_by text;
CREATE INDEX deliveries_manual_idx ON deliveries (manual_requested_at) WHERE manual_requested_at IS NOT NULL;
