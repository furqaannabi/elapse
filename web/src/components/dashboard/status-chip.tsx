/**
 * `StatusChip` — a word in a hairline chip. The word carries the state;
 * the tone only reinforces it (BR-DSH-003). Amber = live, caution =
 * something expiring or pending, destructive = failed/revoked/canceled.
 */
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "live" | "caution" | "destructive" | "muted";

const TONES: Record<ChipTone, string> = {
  neutral: "border-border text-foreground",
  muted: "border-border text-ink-soft",
  live: "border-live/30 bg-live-soft text-live",
  caution: "border-caution/30 bg-caution-soft text-caution",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function StatusChip({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: ChipTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-[12px] font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
