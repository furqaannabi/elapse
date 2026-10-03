-- FR-API-154/156, FR-WRK-076 (ADR 2026-10-02 examples on the demo merchant).
--
-- `demo_seed_key` names each object the demo seed makes (`product:gpu`, `endpoint:saas`, `key:lambda`…)
-- so the seed and the reset find it by that name — never by name or rate, which a judge's object or
-- an example's ("GPU · 4090" shares $0.004/s with "GPU time") can share. A non-null key is also what
-- makes an object protected from demo-session writes (FR-API-153). One live object per key per
-- merchant: a reissued example key revokes the old row and clears its seed key.
--
-- `storefront_name` (FR-API-156) is the name a subscriber sees for a meter on that Product. Only the
-- seed writes it, and no request or response schema carries it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS demo_seed_key TEXT;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS demo_seed_key TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS demo_seed_key TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS storefront_name TEXT;

-- Seed objects made before the key existed.
UPDATE products SET demo_seed_key = 'product:gpu' WHERE demo_seed AND demo_seed_key IS NULL AND rate_usd_per_second = 0.004 AND NOT livemode;
UPDATE products SET demo_seed_key = 'product:inference' WHERE demo_seed AND demo_seed_key IS NULL AND rate_usd_per_second = 0.0005 AND NOT livemode;
UPDATE webhook_endpoints SET demo_seed_key = 'endpoint:sink' WHERE demo_seed AND demo_seed_key IS NULL AND NOT livemode;
UPDATE api_keys SET demo_seed_key = CASE WHEN livemode THEN 'key:pk_live' ELSE 'key:pk' END WHERE demo_seed AND demo_seed_key IS NULL AND kind = 'pk';

CREATE UNIQUE INDEX IF NOT EXISTS products_demo_seed_key ON products (merchant_id, demo_seed_key) WHERE demo_seed_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS webhook_endpoints_demo_seed_key ON webhook_endpoints (merchant_id, demo_seed_key) WHERE demo_seed_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_demo_seed_key ON api_keys (merchant_id, demo_seed_key) WHERE demo_seed_key IS NOT NULL;
