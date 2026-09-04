/**
 * `VerifyLink` — consumes a magic-link token. Success opens the session
 * and replaces the URL with the requested dashboard page. Expired, used, or
 * unknown tokens name the problem and point back to `/login`.
 *
 * `next` must be a dashboard path; anything else falls back to `/dashboard`
 * so a crafted link cannot bounce a merchant off-site.
 *
 * Maps to: FR-DSH-011.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardApi } from "@/lib/dashboard/client";
import { DashboardApiError, type DashboardApi } from "@/lib/dashboard/mock-api";
import { cn } from "@/lib/utils";

type Problem = "link_expired" | "link_used" | "link_invalid" | "error";

const COPY: Record<Problem, { title: string; body: string }> = {
  link_expired: {
    title: "This link has expired.",
    body: "Sign-in links work for 15 minutes. Request a new one and open it sooner.",
  },
  link_used: {
    title: "This link has already been used.",
    body: "Each link works once. Request a new one to sign in again.",
  },
  link_invalid: {
    title: "This link isn't valid.",
    body: "Check that you opened the full link from the email, or request a new one.",
  },
  error: {
    title: "Something went wrong on our side.",
    body: "Nothing has changed. Request a new link and try again.",
  },
};

export function safeNext(next: string | null | undefined): string {
  if (!next) return "/dashboard";
  if (next === "/dashboard" || (next.startsWith("/dashboard/") && !next.startsWith("//"))) return next;
  return "/dashboard";
}

export function VerifyLink({
  api: injected,
  token,
  next,
}: {
  api?: DashboardApi;
  token: string | null;
  next?: string | null;
}) {
  const api = injected ?? getDashboardApi();
  const router = useRouter();
  const [problem, setProblem] = useState<Problem | null>(token ? null : "link_invalid");
  // A token is single-use, so the request must fire once per token even
  // when React re-runs the effect (dev double-invoke, fast refresh).
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!token || attempted.current === token) return;
    attempted.current = token;
    api
      .verifyMagicLink(token)
      .then(() => attempted.current === token && router.replace(safeNext(next)))
      .catch((e: unknown) => {
        if (attempted.current !== token) return;
        const code = e instanceof DashboardApiError ? e.code : "error";
        setProblem(code === "link_expired" || code === "link_used" || code === "link_invalid" ? code : "error");
      });
  }, [api, token, next, router]);

  if (!problem) {
    return (
      <section className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <p className="sr-only">Signing you in</p>
      </section>
    );
  }

  const c = COPY[problem];
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="display-wide text-balance text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
          {c.title}
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">{c.body}</p>
      </div>
      <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full text-[15px] sm:w-auto")}>
        <ArrowLeft data-icon="inline-start" className="size-4" />
        Request a new link
      </Link>
    </section>
  );
}
