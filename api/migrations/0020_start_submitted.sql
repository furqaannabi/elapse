-- FR-API-049: the merchant's start is submitted through the relayer, but the subscription only
-- becomes `active` when StreamStarted ingests. Without a marker for the in-flight window a second
-- start would submit a second transaction: the contract reverts InvalidState, so nothing is
-- double-billed, but gas is wasted and the caller gets a 202 that did nothing.
-- `pending_tx` cannot serve: it already holds the createWithPermitNoStart hash for every
-- authorised-but-unstarted row, so guarding on it would reject the first legitimate start.
ALTER TABLE subscriptions ADD COLUMN start_submitted_at timestamptz;
