/**
 * `Logo` — the Elapse mark and wordmark.
 *
 * The mark is a partial ring with a pen-red arc: the elapsed portion of a
 * whole. Drawn as inline SVG so it inherits `currentColor` and the pen
 * token; no clock hands, no coin.
 *
 * @param withWordmark - Render "Elapse" beside the mark. Default true.
 * @param size - Mark size in px. Default 22.
 */
import { cn } from "@/lib/utils";

export function Logo({
  withWordmark = true,
  size = 22,
  className,
}: {
  withWordmark?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2"
          strokeOpacity="0.22"
        />
        <path
          d="M12 3a9 9 0 0 1 9 9"
          stroke="var(--pen)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </svg>
      {withWordmark && (
        <span
          className="display-wide text-[1.05rem] font-semibold leading-none tracking-[-0.02em]"
          style={{ fontVariationSettings: '"wdth" 105' }}
        >
          Elapse
        </span>
      )}
    </span>
  );
}
