import { z } from "@hono/zod-openapi";

/**
 * FR-API-080 list conventions. `?limit=` 1–100 (default 10), `?starting_after=<id>`,
 * newest first, response `{object:"list", data, has_more, url}`.
 * Repositories fetch `limit + 1` rows and let `page()` decide `has_more`.
 */
export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10).openapi({ example: 10 }),
  starting_after: z.string().optional().openapi({ description: "Id of the last object on the previous page." }),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function ListOf<T extends z.ZodTypeAny>(item: T, name: string) {
  return z
    .object({
      object: z.literal("list"),
      data: z.array(item),
      has_more: z.boolean(),
      url: z.string(),
    })
    .openapi(name);
}

/** Trim the extra row and build the envelope. */
export function page<T>(rows: T[], limit: number, url: string): { object: "list"; data: T[]; has_more: boolean; url: string } {
  const has_more = rows.length > limit;
  return { object: "list", data: has_more ? rows.slice(0, limit) : rows, has_more, url };
}
