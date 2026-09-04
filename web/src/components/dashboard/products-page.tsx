/**
 * `ProductsPage` — `/dashboard/products`.
 *
 * Rows: name, rate per second, ≈ per hour, active meters, status word.
 * "Copy Checkout URL" creates a session and copies its URL (live asks
 * first). Archive confirms by name; running meters continue.
 *
 * Maps to: FR-DSH-030…033, FR-DSH-112; BR-DSH-007, BR-DSH-010.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Link2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { DashboardApiError, type ProductInput } from "@/lib/dashboard/mock-api";
import { useMode } from "@/lib/dashboard/mode";
import type { Product } from "@/lib/dashboard/types";
import { usePoll } from "@/lib/dashboard/use-poll";
import { formatUsd, parseRate, perHour } from "@/lib/meter/math";
import { cn } from "@/lib/utils";
import { CheckBox } from "./check-box";
import { useMerchant } from "./merchant-context";
import { Page, PageHeader } from "./page-header";
import { ProductDrawer } from "./product-drawer";
import { StatusChip } from "./status-chip";

export function ProductsPage() {
  const { api } = useMerchant();
  const mode = useMode();
  const params = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const fetcher = useCallback(() => api.listProducts(mode, { includeArchived: showArchived }), [api, mode, showArchived]);
  const { data, loading, stale, reload } = usePoll(fetcher);

  const [drawer, setDrawer] = useState<{ open: true; product?: Product } | null>(params.get("new") === "1" ? { open: true } : null);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const [liveLink, setLiveLink] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, onError?: (m: string) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      const msg = e instanceof DashboardApiError ? e.message : "Something went wrong. Try again.";
      if (onError) onError(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const save = (input: ProductInput) =>
    run(
      async () => {
        if (drawer?.product) await api.updateProduct(drawer.product.id, input, { idempotencyKey: newIdempotencyKey() });
        else await api.createProduct(mode, input, { idempotencyKey: newIdempotencyKey() });
        setDrawer(null);
        setFormError(null);
        toast.success(drawer?.product ? "Saved" : "Product created");
      },
      setFormError,
    );

  const copyLink = (p: Product) =>
    run(async () => {
      const { url } = await api.createCheckoutLink(p.id, { idempotencyKey: newIdempotencyKey() });
      await navigator.clipboard.writeText(url);
      setLiveLink(null);
      toast.success("Checkout URL copied");
    });

  const archive = (p: Product, status: Product["status"]) =>
    run(async () => {
      await api.updateProduct(p.id, { status }, { idempotencyKey: newIdempotencyKey() });
      setArchiving(null);
      toast.success(status === "archived" ? `Archived ${p.name}` : `Restored ${p.name}`);
    });

  return (
    <Page>
      <PageHeader
        title="Products"
        lede={stale ? "Reconnecting…" : "Anything you charge for by the second."}
        actions={
          <Button onClick={() => setDrawer({ open: true })} className="h-9">
            <Plus data-icon="inline-start" className="size-4" />
            New product
          </Button>
        }
      />
      <label className="mt-6 flex min-h-11 w-fit cursor-pointer items-center gap-2 text-[13px] text-ink-soft md:min-h-8">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="peer sr-only" />
        <CheckBox checked={showArchived} />
        Show archived
      </label>

      {loading || !data ? (
        <Skeleton className="mt-4 h-48 w-full" />
      ) : data.length === 0 ? (
        <div className="mt-4 rounded-lg border border-border px-4 py-12 text-center">
          <p className="text-[14px]">No products yet.</p>
          <p className="mt-1 text-[13px] text-ink-soft">Create one with a rate per second and share its checkout link.</p>
          <Button variant="outline" onClick={() => setDrawer({ open: true })} className="mt-4 h-9">
            New product
          </Button>
        </div>
      ) : (
        <ol aria-label="Products" className="mt-4 divide-y divide-border rounded-lg border border-border">
          <li aria-hidden className="hidden grid-cols-[minmax(0,2fr)_7rem_7rem_6rem_6rem_9.5rem_2.5rem] gap-4 bg-muted/60 px-4 py-2.5 md:grid">
            <span className="placard">Product</span>
            <span className="placard text-right">Per second</span>
            <span className="placard text-right">≈ Per hour</span>
            <span className="placard text-right">Running</span>
            <span className="placard">Status</span>
            <span />
            <span />
          </li>
          {data.map((p) => {
            const nano = parseRate(p.rateUsdPerSecond);
            const archived = p.status === "archived";
            return (
              <li key={p.id} className={cn("relative grid gap-2 px-4 py-3 pr-14 md:grid-cols-[minmax(0,2fr)_7rem_7rem_6rem_6rem_9.5rem_2.5rem] md:items-center md:gap-4 md:pr-4", archived && "text-ink-soft")}>
                <div className="min-w-0">
                  <p className={cn("truncate text-[14px] font-medium", !archived && "text-foreground")}>{p.name}</p>
                  {p.description && <p className="truncate text-[12px] text-ink-soft">{p.description}</p>}
                </div>
                <p className="numerals text-[13px] md:text-right">
                  <span className="placard mr-2 md:hidden">Per second</span>${p.rateUsdPerSecond}
                </p>
                <p className="numerals text-[13px] md:text-right">
                  <span className="placard mr-2 md:hidden">≈ Per hour</span>
                  {formatUsd(perHour(nano), 2)}
                </p>
                <p className="numerals text-[13px] md:text-right">
                  <span className="placard mr-2 md:hidden">Running</span>
                  {p.activeSubscriptions}
                </p>
                <div>
                  <StatusChip tone={archived ? "muted" : "neutral"}>{archived ? "Archived" : "Active"}</StatusChip>
                </div>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={archived || busy}
                    onClick={() => (mode === "live" ? setLiveLink(p) : copyLink(p))}
                    aria-label={`Copy checkout URL for ${p.name}`}
                    className="h-9 md:h-8"
                  >
                    <Link2 data-icon="inline-start" className="size-3.5" />
                    Copy checkout URL
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`} className="absolute top-1.5 right-1 size-11 text-ink-soft hover:text-foreground md:static md:size-9" />}
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => setDrawer({ open: true, product: p })}>Edit…</DropdownMenuItem>
                    {archived ? (
                      <DropdownMenuItem onClick={() => archive(p, "active")}>Restore</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem variant="destructive" onClick={() => setArchiving(p)}>
                        Archive…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ol>
      )}

      {drawer && (
        <ProductDrawer
          open
          initial={drawer.product}
          error={formError}
          busy={busy}
          onCancel={() => {
            setDrawer(null);
            setFormError(null);
          }}
          onSubmit={save}
        />
      )}

      <Dialog open={archiving !== null} onOpenChange={(o) => !o && setArchiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive “{archiving?.name}”?</DialogTitle>
            <DialogDescription>
              No new meters can start on it and its checkout links stop working. Running meters continue until their subscribers stop them. You can restore it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(null)} className="h-9">
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => archiving && archive(archiving, "archived")} className="h-9">
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={liveLink !== null} onOpenChange={(o) => !o && setLiveLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a live checkout link?</DialogTitle>
            <DialogDescription>
              You are in live mode. Anyone who opens this link can start a real meter on “{liveLink?.name}” and pay in real money.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiveLink(null)} className="h-9">
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => liveLink && copyLink(liveLink)} className="h-9">
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
