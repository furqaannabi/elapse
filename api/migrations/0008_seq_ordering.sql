-- Lists are "newest first" (FR-API-080). Two rows can share a created_at, and the random id
-- tiebreak then disagrees with insertion order. A sequence per table makes the order exact.
ALTER TABLE products ADD COLUMN seq bigserial NOT NULL UNIQUE;
ALTER TABLE webhook_endpoints ADD COLUMN seq bigserial NOT NULL UNIQUE;
ALTER TABLE checkout_sessions ADD COLUMN seq bigserial NOT NULL UNIQUE;
ALTER TABLE deliveries ADD COLUMN seq bigserial NOT NULL UNIQUE;
DROP INDEX products_merchant_idx;
CREATE INDEX products_merchant_idx ON products (merchant_id, livemode, seq DESC);
DROP INDEX webhook_endpoints_merchant_idx;
CREATE INDEX webhook_endpoints_merchant_idx ON webhook_endpoints (merchant_id, livemode, seq DESC);
DROP INDEX deliveries_endpoint_idx;
CREATE INDEX deliveries_endpoint_idx ON deliveries (endpoint_id, seq DESC);
