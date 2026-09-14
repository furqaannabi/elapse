-- FR-CON-019 / FR-API-049 (merchant-started metering, signed 2026-09-14).
-- A product says when its meter begins: at authorisation ('checkout', today's behaviour and the
-- default) or when the merchant says the resource is ready ('merchant'). Furqaan chose the product
-- as the home for this, 2026-09-14: it is a property of how the thing is billed, not of each session.
ALTER TABLE products ADD COLUMN start_mode text NOT NULL DEFAULT 'checkout'
  CHECK (start_mode IN ('checkout', 'merchant'));

-- Snapshotted onto the subscription at prepare, so a running meter keeps the mode it was created
-- under even if the product changes later — the same reasoning that snapshots feeBps into a clone.
ALTER TABLE subscriptions ADD COLUMN start_mode text NOT NULL DEFAULT 'checkout'
  CHECK (start_mode IN ('checkout', 'merchant'));

-- The expiry sweep (FR-WRK-075) scans for funded-but-unstarted rows; keep it off a full table scan.
CREATE INDEX subscriptions_unstarted_idx ON subscriptions (created_at)
  WHERE status = 'incomplete' AND start_mode = 'merchant';
