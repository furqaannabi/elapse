import { SQL } from "bun";

/**
 * One Postgres pool for the process, built from `DATABASE_URL` (technical
 * design §6). Bun's native driver: tagged-template queries are parameterised,
 * never interpolated, so SQL injection is structurally impossible here.
 * Money columns come back as strings (NUMERIC) and stay strings (BR-API-004).
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = new SQL({ url, max: 10 });

/** Close the pool (tests, graceful shutdown). */
export async function closeDb(): Promise<void> {
  await sql.close();
}
