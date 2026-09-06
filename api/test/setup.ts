/**
 * Test preload (bunfig.toml). Points the app at the test database before any
 * module reads DATABASE_URL, then brings the schema up to date once per run.
 * Every test file truncates what it touches via `resetDb()` in test/helpers.ts.
 */
// Assignments, not `??=`: Bun auto-loads api/.env before this preload runs, and tests must never
// see the dev database, the dev ingest token, or a relayer key.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://elapse:elapse@localhost:55434/elapse_test";
process.env.NODE_ENV = "test";
process.env.INGEST_TOKEN = "ingest-test-token";
// Test-only key-encryption key (32 zero-ish bytes, base64). Real environments use `openssl rand -base64 32`.
process.env.WEBHOOK_SECRET_KEK = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";
delete process.env.RELAYER_PRIVATE_KEY;
// The CLI stream polls fast in tests so frames arrive within a few ms (FR-API-131).
process.env.CLI_STREAM_POLL_MS = "20";
process.env.CLI_STREAM_HEARTBEAT_MS = "100";

const { migrate } = await import("../src/db/migrate");
await migrate();

export {};
