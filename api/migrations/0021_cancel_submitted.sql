-- FR-WRK-075 / FR-API-127: the unstarted sweep cancels through the relayer, but the row stays
-- `incomplete` until StreamCanceled ingests. Without a marker the next tick would cancel it again.
-- `pending_tx` cannot serve (it holds the funding tx on every one of these rows), and there is no
-- `canceling` status — the enum is incomplete|active|paused|canceled and stays that way.
-- Stamped only on a successful submit, so a failed cancel is retried on the next tick.
ALTER TABLE subscriptions ADD COLUMN cancel_submitted_at timestamptz;
