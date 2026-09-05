import { describe, expect, test } from "bun:test";
import { sql } from "../src/db/client";
import { listMigrationFiles, migrate } from "../src/db/migrate";

describe("migrations", () => {
  test("every file in migrations/ is applied exactly once, and a second run is a no-op", async () => {
    const files = await listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const first = await migrate();
    const second = await migrate();
    expect(second).toEqual([]);

    const rows = await sql`SELECT name FROM schema_migrations ORDER BY name`;
    expect(rows.map((r: { name: string }) => r.name)).toEqual(files);
    expect(first.every((n) => files.includes(n))).toBe(true);
  });
});
