-- Dashboard sign-in (FR-API-100, FR-API-101). Both tokens are stored hashed: a database
-- leak yields neither a usable link nor a usable cookie.
CREATE TABLE magic_links (
  token_hash   bytea PRIMARY KEY,
  email        text NOT NULL,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX magic_links_email_recent_idx ON magic_links (email, created_at DESC);
CREATE INDEX magic_links_ip_recent_idx ON magic_links (ip, created_at DESC);

CREATE TABLE dashboard_sessions (
  id            text PRIMARY KEY,               -- ses_… for the audit log; never the cookie value
  token_hash    bytea NOT NULL UNIQUE,
  merchant_id   text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX dashboard_sessions_merchant_idx ON dashboard_sessions (merchant_id);
