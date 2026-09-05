import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "./client";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

/** Sorted `NNNN_name.sql` files in `api/migrations/`. Order is lexical, so keep the zero-padded prefix. */
export async function listMigrationFiles(): Promise<string[]> {
  const names = await readdir(MIGRATIONS_DIR);
  return names.filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
}

/**
 * Apply every migration not yet in `schema_migrations`, each inside its own
 * transaction, oldest first. Idempotent: a second run applies nothing.
 * Returns the names applied this run. Run via `bun run migrate` or the test preload.
 */
export async function migrate(): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  // Serialise concurrent runners (two test workers, two Railway replicas on deploy).
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(72641057)`;
    const done = new Set((await tx`SELECT name FROM schema_migrations`).map((r: { name: string }) => r.name));
    for (const name of await listMigrationFiles()) {
      if (done.has(name)) continue;
      const body = await Bun.file(join(MIGRATIONS_DIR, name)).text();
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      applied.push(name);
    }
  });
  return applied;
}

if (import.meta.main) {
  const names = await migrate();
  console.log(names.length ? `applied: ${names.join(", ")}` : "up to date");
  await sql.close();
}
