/**
 * `useShowMore` — page a long list in the browser: show `step` rows, then
 * `step` more per click. Resets when the list identity changes.
 */
"use client";

import { useState } from "react";

export function useShowMore<T>(rows: T[] | null | undefined, step = 50) {
  const [limit, setLimit] = useState(step);
  const [key, setKey] = useState(rows);
  if (key !== rows) {
    setKey(rows);
    setLimit(step);
  }
  const all = rows ?? [];
  return { visible: all.slice(0, limit), hasMore: all.length > limit, remaining: Math.max(0, all.length - limit), more: () => setLimit((l) => l + step) };
}
