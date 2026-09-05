-- Week 3, slice 1. FR-API-020, FR-API-040, FR-API-050, FR-API-070..073, FR-API-107.
-- Money columns are token base units (6-decimal AUSD/MockUSD) as numeric(78,0); decimals on the wire only.

CREATE TABLE customers (
  id              text PRIMARY KEY,
  seq             bigserial NOT NULL UNIQUE,
  merchant_id     text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode        boolean NOT NULL,
  email           text,
  passkey_id      text,
  wallet_address  text NOT NULL,             -- lowercase hex
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, livemode, wallet_address)
);
CREATE INDEX customers_wallet_idx ON customers (wallet_address);

CREATE TABLE subscriptions (
  id                    text PRIMARY KEY,
  seq                   bigserial NOT NULL UNIQUE,
  merchant_id           text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode              boolean NOT NULL,
  product_id            text NOT NULL REFERENCES products(id),
  customer_id           text NOT NULL REFERENCES customers(id),
  checkout_session_id   text REFERENCES checkout_sessions(id),
  status                text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'active', 'paused', 'canceled')),
  ended_reason          text CHECK (ended_reason IS NULL OR ended_reason IN ('canceled', 'cap_reached')),
  chain_id              integer NOT NULL,
  stream_address        text,                 -- lowercase hex, known once StreamCreated is ingested or the receipt is read
  pending_tx            text,                 -- relayer tx hash from `start`; lets ingest match StreamCreated before the address is stored
  rate_per_second_wei   numeric(78,0) NOT NULL,
  max_duration_seconds  integer NOT NULL,
  max_escrow_wei        numeric(78,0) NOT NULL,
  funded_wei            numeric(78,0) NOT NULL DEFAULT 0,
  settled_wei           numeric(78,0) NOT NULL DEFAULT 0,   -- gross, cumulative
  settled_fee_wei       numeric(78,0) NOT NULL DEFAULT 0,
  settled_seconds       integer NOT NULL DEFAULT 0,
  paused_seconds        integer NOT NULL DEFAULT 0,          -- total time spent paused, for seconds_elapsed
  started_at            timestamptz,
  paused_at             timestamptz,
  canceled_at           timestamptz,
  permit_nonce          numeric(78,0),
  permit_deadline       timestamptz,
  simulated             boolean NOT NULL DEFAULT false,
  test_clock_id         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, stream_address)
);
CREATE INDEX subscriptions_merchant_idx ON subscriptions (merchant_id, livemode, seq DESC);
CREATE INDEX subscriptions_customer_idx ON subscriptions (customer_id);
CREATE INDEX subscriptions_pending_tx_idx ON subscriptions (chain_id, pending_tx) WHERE pending_tx IS NOT NULL;

ALTER TABLE checkout_sessions
  ADD CONSTRAINT checkout_sessions_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
  ADD CONSTRAINT checkout_sessions_subscription_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);

-- One row per chain log the indexer delivered; the idempotency key for ingest (FR-API-070).
CREATE TABLE chain_events (
  id               bigserial PRIMARY KEY,
  chain_id         integer NOT NULL,
  block_number     bigint NOT NULL,
  block_hash       text NOT NULL,
  block_timestamp  bigint NOT NULL,
  tx_hash          text NOT NULL,
  log_index        integer NOT NULL,
  address          text NOT NULL,
  event_name       text NOT NULL,
  args             jsonb NOT NULL,
  ledger           jsonb NOT NULL DEFAULT '[]'::jsonb,
  subscription_id  text REFERENCES subscriptions(id),   -- NULL when the address matched nothing (FR-API-072)
  received_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX chain_events_unmatched_idx ON chain_events (chain_id, tx_hash) WHERE subscription_id IS NULL;

ALTER TABLE events ADD CONSTRAINT events_chain_event_fk FOREIGN KEY (chain_event_id) REFERENCES chain_events(id);

CREATE TABLE invoices (
  id               text PRIMARY KEY,
  seq              bigserial NOT NULL UNIQUE,
  merchant_id      text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode         boolean NOT NULL,
  subscription_id  text NOT NULL REFERENCES subscriptions(id),
  customer_id      text NOT NULL REFERENCES customers(id),
  period_start     timestamptz NOT NULL,
  period_end       timestamptz NOT NULL,
  seconds          integer NOT NULL,
  amount_wei       numeric(78,0) NOT NULL,   -- gross
  fee_wei          numeric(78,0) NOT NULL,
  status           text NOT NULL CHECK (status IN ('paid', 'failed')),
  tx_hash          text NOT NULL,
  log_index        integer NOT NULL,
  chain_event_id   bigint REFERENCES chain_events(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_merchant_idx ON invoices (merchant_id, livemode, seq DESC);
CREATE INDEX invoices_subscription_idx ON invoices (subscription_id, seq DESC);

-- Money movements from the indexer's ledger array (FR-API-107, indexer FR-IDX-014). Never updated except reversed_by.
CREATE TABLE ledger_entries (
  id               text PRIMARY KEY,
  seq              bigserial NOT NULL UNIQUE,
  merchant_id      text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode         boolean NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('deposit', 'settlement', 'fee', 'refund')),
  amount_wei       numeric(78,0) NOT NULL,
  from_address     text NOT NULL,
  to_address       text NOT NULL,
  subscription_id  text NOT NULL REFERENCES subscriptions(id),
  customer_id      text NOT NULL REFERENCES customers(id),
  chain_id         integer NOT NULL,
  tx_hash          text NOT NULL,
  log_index        integer NOT NULL,
  block_hash       text NOT NULL,
  block_timestamp  bigint NOT NULL,
  chain_event_id   bigint REFERENCES chain_events(id),
  reversed_by      text REFERENCES ledger_entries(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index, kind, block_hash)
);
CREATE INDEX ledger_entries_merchant_idx ON ledger_entries (merchant_id, livemode, seq DESC);
CREATE INDEX ledger_entries_subscription_idx ON ledger_entries (subscription_id);
