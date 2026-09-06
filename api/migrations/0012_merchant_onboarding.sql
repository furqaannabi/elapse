-- FR-API-103 / FR-DSH-013: first-run capture. `name` is seeded from the email at first sign-in;
-- the dashboard shows the first-run form until `onboarded_at` is set by POST /v1/dashboard/me.
ALTER TABLE merchants ADD COLUMN onboarded_at timestamptz;
