/**
 * `CheckBox` — visual for a visually-hidden native checkbox (`peer sr-only`
 * input beside it): 4px-radius box, check when on, focus ring from the
 * input. Keeps native semantics with the world's grammar.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CheckBox({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
        checked ? "border-foreground bg-foreground text-background" : "border-input",
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}
