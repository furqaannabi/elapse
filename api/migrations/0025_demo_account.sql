-- FR-API-152/154, FR-WRK-076 (ADR 2026-10-02 demo account): the shared demo merchant judges reach
-- with a PIN.
--
-- `merchants.demo` marks it, and the partial unique index keeps it to one row: the demo sign-in,
-- the allowlist, the faucet exemption and the six-hourly reset all find it by this flag, never by
-- email. `dashboard_sessions.demo` marks a session minted by the PIN, which the allowlist reads.
-- `demo_seed` marks the products, endpoint and keys the seed created, so the reset can tell them
-- from a judge's. `demo_pin_attempts` counts wrong PINs per IP and across everyone.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS merchants_one_demo ON merchants (demo) WHERE demo;

ALTER TABLE dashboard_sessions ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS demo_pin_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT,
  ok BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_pin_attempts_ip_created ON demo_pin_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS demo_pin_attempts_created ON demo_pin_attempts (created_at);
