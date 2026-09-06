-- FR-WRK-060. One row per worker process, refreshed every 5 s; GET /v1/status reads the newest.
CREATE TABLE worker_heartbeat (
  worker_id             text PRIMARY KEY,
  seen_at               timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz NOT NULL DEFAULT now(),
  attempts_last_minute  integer NOT NULL DEFAULT 0,
  success_rate_1h       numeric(5,4),          -- NULL until an attempt exists
  keeper_last_tick_at   timestamptz
);
