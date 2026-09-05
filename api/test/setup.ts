/**
 * Test preload (bunfig.toml). Points the app at the test database before any
 * module reads DATABASE_URL, then brings the schema up to date once per run.
 * Every test file truncates what it touches via `resetDb()` in test/helpers.ts.
 */
process.env.DATABASE_URL ??=
  process.env.TEST_DATABASE_URL ?? "postgres://elapse:elapse@localhost:55434/elapse_test";
process.env.NODE_ENV = "test";

const { migrate } = await import("../src/db/migrate");
await migrate();

export {};
