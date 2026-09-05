-- Week 2, slice 1. Tables for FR-API-001/002/006/010/011.
-- Ids are text with Stripe-style prefixes (mrc_, key_, prod_). Every merchant-scoped
-- table carries `livemode` (BR-API-001). Money is NUMERIC, never float (BR-API-004).

CREATE TABLE merchants (
  id                          text PRIMARY KEY,
  name                        text NOT NULL,
  email                       text NOT NULL UNIQUE,
  support_email               text,
  support_url                 text,
  payout_address              text,
  branding                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_endpoint_exhausted   boolean NOT NULL DEFAULT true,
  notify_key_expiry           boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Secret keys: SHA-256 of the plaintext + last 4 chars; plaintext never stored (FR-API-002).
-- Publishable keys are not secret, so `hash` holds the SHA-256 too (one lookup path) and
-- the plaintext is reconstructable from `plaintext` for display; sk rows leave it NULL.
CREATE TABLE api_keys (
  id            text PRIMARY KEY,
  merchant_id   text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode      boolean NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('pk', 'sk')),
  name          text NOT NULL,
  hash          bytea NOT NULL UNIQUE,
  last4         text NOT NULL,
  plaintext     text,                       -- pk only; sk is always NULL
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz,                -- set by roll-with-grace (FR-API-105)
  CONSTRAINT api_keys_sk_no_plaintext CHECK (kind = 'pk' OR plaintext IS NULL)
);
CREATE INDEX api_keys_merchant_idx ON api_keys (merchant_id, livemode);

CREATE TABLE products (
  id                   text PRIMARY KEY,
  merchant_id          text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode             boolean NOT NULL,
  name                 text NOT NULL,
  description          text,
  rate_usd_per_second  numeric(38,18) NOT NULL CHECK (rate_usd_per_second > 0),
  rate_per_second_wei  numeric(78,0) NOT NULL CHECK (rate_per_second_wei > 0),
  allow_pause          boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_merchant_idx ON products (merchant_id, livemode, created_at DESC);

-- FR-API-006. Never holds secret values, only ids and last4 (FR-API-110).
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  merchant_id  text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  actor        text NOT NULL,      -- 'dashboard' | 'api_key:<id>' | 'system'
  action       text NOT NULL,
  target       text,
  ip           text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_merchant_idx ON audit_log (merchant_id, at DESC);
