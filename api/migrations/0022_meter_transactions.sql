-- FR-API-143: the meter's two transactions, denormalised onto the subscription.
--
-- Both are already in `chain_events`, but `@elapse/react` re-reads the public session every 5 s
-- (checkout FR-CHK-032), so the proof drop must not cost a join on that path. Written at ingest
-- from StreamStarted and StreamCanceled; null until each happens.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS start_tx TEXT,
  ADD COLUMN IF NOT EXISTS end_tx TEXT;
