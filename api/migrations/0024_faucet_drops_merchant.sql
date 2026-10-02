-- FR-API-151 (ADR 2026-10-02 dashboard faucet): who asked for each drop, and through which door,
-- so the dashboard's per-merchant limit can be counted. Checkout drops carry the session's merchant;
-- dashboard drops the signed-in one. Only dashboard drops count toward the merchant's three a day —
-- a subscriber's drop in a merchant's checkout is not the merchant asking. Rows written before
-- these columns existed are checkout drops with no merchant and count for nobody.
ALTER TABLE faucet_drops ADD COLUMN IF NOT EXISTS merchant_id TEXT;
ALTER TABLE faucet_drops ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'checkout' CHECK (via IN ('checkout', 'dashboard'));
CREATE INDEX IF NOT EXISTS faucet_drops_merchant_created ON faucet_drops (merchant_id, via, created_at);
