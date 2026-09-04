/** `ShowMore` — the "Show N more" control under a paged list. */
"use client";

import { Button } from "@/components/ui/button";

export function ShowMore({ remaining, onMore, step = 50 }: { remaining: number; onMore: () => void; step?: number }) {
  if (remaining <= 0) return null;
  return (
    <div className="mt-3 flex items-center justify-center">
      <Button variant="outline" onClick={onMore} className="h-9">
        Show {Math.min(step, remaining)} more
        <span className="ml-1 text-ink-soft">· {remaining} left</span>
      </Button>
    </div>
  );
}
