/**
 * Test preload (bunfig.toml). Points the app at the test database before any
 * module reads DATABASE_URL, then brings the schema up to date once per run.
 * Every test file truncates what it touches via `resetDb()` in test/helpers.ts.
 */
// Assignments, not `??=`: Bun auto-loads api/.env before this preload runs, and tests must never
// see the dev database, the dev ingest token, or a relayer key.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://elapse:elapse@localhost:55434/elapse_test";
process.env.NODE_ENV = "test";
// Let a cancelled CLI stream notice it was cancelled promptly. The production default is 500 ms,
// which leaves a wide window for its next SELECT to collide with the following test's TRUNCATE.
// `??=` here, unlike the assignments above: this one is a knob, not a safety rail.
process.env.CLI_STREAM_POLL_MS ??= "25";
process.env.INGEST_TOKEN = "ingest-test-token";
// Test-only key-encryption key (32 zero-ish bytes, base64). Real environments use `openssl rand -base64 32`.
process.env.WEBHOOK_SECRET_KEK = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";
delete process.env.RELAYER_PRIVATE_KEY;
// The developer's Privy app must not leak into tests: FR-API-125 asserts the unconfigured path, and route tests mint their own keys.
delete process.env.PRIVY_APP_ID;
delete process.env.PRIVY_VERIFICATION_KEY;
// The CLI stream polls fast in tests so frames arrive within a few ms (FR-API-131).
process.env.CLI_STREAM_POLL_MS = "20";
process.env.CLI_STREAM_HEARTBEAT_MS = "100";
// The docs reference's try-it panel origin (FR-API-086).
process.env.DOCS_ORIGIN = "https://docs.test";

const { migrate } = await import("../src/db/migrate");
await migrate();

export {};
