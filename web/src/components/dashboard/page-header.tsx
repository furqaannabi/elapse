/**
 * `PageHeader` — title row every dashboard page opens with: the heading,
 * an optional one-line lede, and actions at the right. No kicker.
 */
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  lede,
  actions,
  className,
  titleClassName,
}: {
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** e.g. `numerals` when the title is a machine string such as a URL. */
  titleClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className={cn("text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]", titleClassName)}>{title}</h1>
        {lede && <div className="mt-1 max-w-[56ch] text-[14px] text-ink-soft [overflow-wrap:anywhere]">{lede}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The padded, width-capped body every ordinary page uses. */
export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full px-5 py-6 md:px-8 md:py-8", wide ? "" : "max-w-[1280px]", className)}>
      {children}
    </div>
  );
}
