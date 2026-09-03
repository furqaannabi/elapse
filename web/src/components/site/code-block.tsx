/**
 * `CodeBlock` — a monochrome code panel in the world's grammar: chart
 * paper, a placard title, and a copy control. Tokens are coloured with a
 * tiny hand-rolled highlighter (strings in pen, comments soft) so the page
 * does not ship a syntax-highlighting dependency.
 *
 * @param code - Source text.
 * @param title - Placard label, e.g. "server.ts".
 * @param lang - "ts" | "json" | "sh". Drives the highlighter.
 */
import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

type Lang = "ts" | "json" | "sh";

export function CodeBlock({
  code,
  title,
  lang = "ts",
  className,
}: {
  code: string;
  title?: string;
  lang?: Lang;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <div className="flex h-9 items-center justify-between border-b border-border pl-3 pr-1">
        <span className="code-title truncate">{title ?? lang}</span>
        <CopyButton text={code} label={`Copy ${title ?? "code"}`} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-[1.6]">
        <code className="font-mono">{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

const TOKEN =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/.*$|#.*$)|\b(const|await|new|import|from|export|function|return|npm|npx|install)\b|(\b\d+(?:\.\d+)?\b)/gm;

function highlight(code: string, lang: Lang) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const [text, str, comment, kw, num] = m;
    let cls = "";
    if (str) cls = "text-pen";
    else if (comment) cls = "text-ink-soft";
    else if (kw) cls = lang === "json" ? "" : "text-ink-soft";
    else if (num) cls = "text-live";
    out.push(
      <span key={i++} className={cls}>
        {text}
      </span>,
    );
    last = idx + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
