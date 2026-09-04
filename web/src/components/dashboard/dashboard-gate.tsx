/**
 * `DashboardGate` — the client boundary every `/dashboard/*` route sits
 * behind. Loads the session; without one it redirects to `/login?next=`;
 * a merchant with no business name yet gets the first-run screen; then the
 * shell renders around the page.
 *
 * The session itself is an HttpOnly cookie the API sets (the mock stands it
 * in with localStorage). JavaScript never reads it; it only asks `me()`.
 *
 * Maps to: FR-DSH-012, FR-DSH-013, FR-DSH-014.
 */
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardApi } from "@/lib/dashboard/client";
import { DashboardApiError, type DashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";
import { FirstRunForm } from "./first-run-form";
import { MerchantProvider } from "./merchant-context";
import { DashboardShell } from "./shell";

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
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((merchant) => alive && setLoad({ status: "ready", merchant }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof DashboardApiError && e.code === "unauthenticated") {
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
    await api.signOut();
    router.replace("/login");
  }, [api, router]);

  if (load.status === "loading" || load.status === "redirecting") return <GateSkeleton />;

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

function GateSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background" aria-busy>
      <div className="hidden w-[232px] shrink-0 border-r border-border p-4 lg:block">
        <Skeleton className="h-5 w-24" />
        <div className="mt-8 flex flex-col gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-32" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-14 items-center border-b border-border px-6">
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    </div>
  );
}
