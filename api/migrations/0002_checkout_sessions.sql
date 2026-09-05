-- Week 2, slice 3. FR-API-030/031/033.
-- customer_id / subscription_id are plain text until the customers and
-- subscriptions migrations add the tables and the foreign keys.
CREATE TABLE checkout_sessions (
  id                    text PRIMARY KEY,
  merchant_id           text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode              boolean NOT NULL,
  product_id            text NOT NULL REFERENCES products(id),
  customer_id           text,
  subscription_id       text,
  success_url           text NOT NULL,
  cancel_url            text NOT NULL,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete', 'expired')),
  expires_at            timestamptz NOT NULL,
  max_duration_seconds  integer CHECK (max_duration_seconds IS NULL OR max_duration_seconds BETWEEN 60 AND 2592000),
  test_clock_id         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkout_sessions_merchant_idx ON checkout_sessions (merchant_id, livemode, created_at DESC);
CREATE INDEX checkout_sessions_open_expiry_idx ON checkout_sessions (expires_at) WHERE status = 'open';
