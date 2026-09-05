-- Week 2, slice 5. FR-API-063/064/073, worker FR-WRK-001.
CREATE TABLE events (
  id                text PRIMARY KEY,
  seq               bigserial NOT NULL UNIQUE,   -- insertion order; `created` is whole seconds
  merchant_id       text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  livemode          boolean NOT NULL,
  type              text NOT NULL,
  data              jsonb NOT NULL,
  raw_body          text NOT NULL,          -- the exact bytes the worker signs and sends (FR-WRK-021)
  created           timestamptz NOT NULL DEFAULT now(),
  pending_webhooks  integer NOT NULL DEFAULT 0,   -- value at creation; the API recomputes on read
  chain_event_id    bigint,                 -- FK added with the ingest migration
  request           jsonb
);
CREATE INDEX events_merchant_idx ON events (merchant_id, livemode, seq DESC);
CREATE INDEX events_merchant_type_idx ON events (merchant_id, livemode, type, seq DESC);

CREATE TABLE deliveries (
  id               text PRIMARY KEY,
  event_id         text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  endpoint_id      text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'retrying', 'succeeded', 'exhausted', 'manual')),
  attempt          integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_due_idx ON deliveries (next_attempt_at) WHERE status IN ('queued', 'retrying');
CREATE INDEX deliveries_event_idx ON deliveries (event_id);
CREATE INDEX deliveries_endpoint_idx ON deliveries (endpoint_id, created_at DESC);

CREATE TABLE delivery_attempts (
  id                text PRIMARY KEY,
  delivery_id       text NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  n                 integer NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  duration_ms       integer,
  status_code       integer,
  error             text,
  request_headers   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- includes X-Elapse-Signature (public), never the secret
  response_excerpt  text,
  UNIQUE (delivery_id, n)
);
