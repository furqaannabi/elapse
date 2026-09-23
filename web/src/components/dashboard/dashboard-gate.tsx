/**
 * `DashboardGate` — the client boundary every `/dashboard/*` route sits
 * behind. Loads the session; without one it redirects to `/login?next=`;
 * a merchant with no business name yet gets the first-run screen; then the
 * shell renders around the page.
 *
 * The session itself is an HttpOnly cookie the API sets (the mock stands it
 * in with localStorage). JavaScript never reads it; it only asks `me()`.
 *
 * While `me()` is in flight the real shell renders with `merchant: null`,
 * so a refresh shows the wordmark, the sections and the top bar at once and
 * only the page slot waits. The page slot carries the same title-and-table
 * shape every page resolves into, so nothing jumps when the answer lands.
 *
 * That frame is right for a merchant coming back and wrong for a visitor who
 * followed the Dashboard link with no session: it showed them a dashboard
 * they do not have, for as long as `me()` took to answer 401. The session
 * cookie belongs to the API's own host, so this origin cannot read it and
 * cannot know before asking. What it can remember is that someone has signed
 * in here before — a boolean, never a token (`SECURITY.md`: merchant tokens
 * are HttpOnly cookies and never localStorage). With the flag, the shell;
 * without it, the wordmark alone until the answer lands. The flag is read
 * after mount, so the server's HTML and the first client render agree.
 *
 * Maps to: FR-DSH-012, FR-DSH-013, FR-DSH-014.
 */
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardApi } from "@/lib/dashboard/client";
import { DashboardApiError, type DashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";
import { FirstRunForm } from "./first-run-form";
import { MerchantProvider } from "./merchant-context";
import { Page } from "./page-header";
import { DashboardShell } from "./shell";

/** Someone has held a session in this browser before. A hint for the loading frame, nothing more. */
const RETURNING_KEY = "elapse.dashboard.returning";

/** Storage throws in private windows and with site data blocked, so every touch is guarded. */
function wasHereBefore(): boolean {
  try {
    return localStorage.getItem(RETURNING_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberVisit(): void {
  try {
    localStorage.setItem(RETURNING_KEY, "1");
  } catch {
    // A browser that will not remember simply gets the quiet frame every time.
  }
}

/** The flag never changes under a mounted gate: sign-out and a 401 both navigate away. */
const subscribe = () => () => {};

function forgetVisit(): void {
  try {
    localStorage.removeItem(RETURNING_KEY);
  } catch {
    // Nothing to forget if nothing could be stored.
  }
}

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "redirecting" }
  | { status: "ready"; merchant: Merchant };

export function DashboardGate({ api: injected, children }: { api?: DashboardApi; children: React.ReactNode }) {
  const api = injected ?? getDashboardApi();
  const router = useRouter();
  const pathname = usePathname();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // This gate is server-rendered, where `localStorage` does not exist, so the server can only say
  // "not returning" — and a first client render that disagreed with the HTML it is hydrating is a
  // mismatch. `useSyncExternalStore` is the supported way to hold a value that differs between the
  // two: both emit the quiet frame, and a returning merchant is upgraded to the shell immediately
  // after hydration, on the same tick as `me()` is asked.
  const returning = useSyncExternalStore(subscribe, wasHereBefore, () => false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((merchant) => {
        if (!alive) return;
        rememberVisit();
        setLoad({ status: "ready", merchant });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof DashboardApiError && e.code === "unauthenticated") {
          // Whatever this browser remembered is wrong: the session is gone.
          forgetVisit();
          setLoad({ status: "redirecting" });
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        } else {
          setLoad({ status: "error" });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, router, pathname, reloadKey]);

  const setMerchant = useCallback((merchant: Merchant) => setLoad({ status: "ready", merchant }), []);

  const signOut = useCallback(async () => {
    forgetVisit();
    await api.signOut();
    router.replace("/login");
  }, [api, router]);

  if (load.status === "loading" || load.status === "redirecting") {
    return returning ? (
      <DashboardShell merchant={null}>
        <PagePlaceholder />
      </DashboardShell>
    ) : (
      <QuietFrame />
    );
  }

  if (load.status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-[15px]">We couldn&apos;t reach Elapse.</p>
        <p className="text-[13px] text-ink-soft">Nothing has changed. Try again in a moment.</p>
        <Button
          variant="outline"
          onClick={() => {
            setLoad({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const { merchant } = load;
  if (merchant.name === null) {
    return <FirstRunForm api={api} email={merchant.email} onDone={setMerchant} />;
  }

  return (
    <MerchantProvider value={{ merchant, api, setMerchant }}>
      <DashboardShell merchant={merchant} onSignOut={signOut}>
        {children}
      </DashboardShell>
    </MerchantProvider>
  );
}

/**
 * What a visitor with no remembered session sees while `me()` answers: the
 * wordmark on the page background, and nothing that belongs to anybody.
 * Usually a flicker; on a slow connection, a calm one.
 */
function QuietFrame() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <span className="sr-only">Loading</span>
      <Logo aria-hidden />
    </div>
  );
}

/**
 * The page slot while the session loads: a title line, a lede, then a ruled
 * table of hairline rows, the shape every list page settles into. The text
 * is for screen readers; sighted users read the shape.
 */
function PagePlaceholder() {
  return (
    <Page>
      <span className="sr-only">Loading your dashboard</span>
      <Skeleton className="h-7 w-40" aria-hidden />
      <Skeleton className="mt-3 h-4 w-64 max-w-full" aria-hidden />
      <div className="mt-8 divide-y divide-border rounded-md border border-border" aria-hidden>
        <div className="flex h-10 items-center gap-6 px-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-16" />
          <Skeleton className="hidden h-3 w-16 sm:block" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex h-16 items-center gap-6 px-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32 max-w-[60%]" />
              <Skeleton className="h-3 w-52 max-w-[80%]" />
            </div>
            <Skeleton className="h-4 w-14" />
            <Skeleton className="hidden h-4 w-14 sm:block" />
          </div>
        ))}
      </div>
    </Page>
  );
}
