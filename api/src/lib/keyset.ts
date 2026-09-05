import type { SQL } from "bun";
import { sql } from "../db/client";

/** A `sql`…`` fragment (Bun's `SQL.Query`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fragment = SQL.Query<any>;

export class CursorNotFound extends Error {
  constructor(public readonly id: string) {
    super(`No such object: '${id}'`);
  }
}

/**
 * FR-API-080 keyset page over a `seq bigserial` table, newest first, scoped to merchant+mode.
 * `filters` are extra `AND` fragments. Fetches `limit + 1` rows so `page()` can set `has_more`.
 */
export async function keysetList<T>(
  table: string,
  cols: Fragment,
  scope: Fragment,
  filters: Fragment[],
  opts: { limit: number; startingAfter?: string | undefined },
): Promise<T[]> {
  const where = filters.reduce<Fragment>((acc, f) => sql`${acc} AND ${f}`, scope);
  const t = sql(table);
  if (opts.startingAfter) {
    const [cursor] = await sql`SELECT seq FROM ${t} WHERE id = ${opts.startingAfter} AND ${scope}`;
    if (!cursor) throw new CursorNotFound(opts.startingAfter);
    return (await sql`SELECT ${cols} FROM ${t} WHERE ${where} AND seq < ${cursor.seq} ORDER BY seq DESC LIMIT ${opts.limit + 1}`) as T[];
  }
  return (await sql`SELECT ${cols} FROM ${t} WHERE ${where} ORDER BY seq DESC LIMIT ${opts.limit + 1}`) as T[];
}
