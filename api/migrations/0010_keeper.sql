-- Week 3. Keeper cadence (contracts FR-CON-033/034, Undecided 6: 5 minutes). When the keeper last
-- asked the chain to settle this stream; the Settled log itself arrives via ingest.
ALTER TABLE subscriptions ADD COLUMN last_settle_requested_at timestamptz;
CREATE INDEX subscriptions_keeper_idx ON subscriptions (chain_id, last_settle_requested_at) WHERE status = 'active' AND stream_address IS NOT NULL;
