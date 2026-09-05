/**
 * Test preload (bunfig.toml). Points the app at the test database before any
 * module reads DATABASE_URL, then brings the schema up to date once per run.
 * Every test file truncates what it touches via `resetDb()` in test/helpers.ts.
 */
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgres://elapse:elapse@localhost:55434/elapse_test";
process.env.NODE_ENV = "test";
// Test-only key-encryption key (32 zero-ish bytes, base64). Real environments use `openssl rand -base64 32`.
process.env.WEBHOOK_SECRET_KEK ??= "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=";

const { migrate } = await import("../src/db/migrate");
await migrate();

export {};
