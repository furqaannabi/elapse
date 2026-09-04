/**
 * `BrandingSection` — what a merchant may brand on the hosted checkout:
 * display name, logo (PNG/SVG ≤ 200 KB), accent colour, support URL; a
 * live preview renders the real `CheckoutFrame` at 390 px. Layout and
 * copy of the checkout are never editable here.
 *
 * Maps to: FR-DSH-103; FR-CHK-014.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckoutFrame } from "@/components/checkout/checkout-frame";
import { RatePanel } from "@/components/checkout/rate-panel";
import { contrastRatio, PAPER } from "@/lib/dashboard/color";
import { newIdempotencyKey } from "@/lib/dashboard/idempotency";
import { useMerchant } from "./merchant-context";
import { Section } from "./settings-sections";

const MAX_LOGO_BYTES = 200 * 1024;

export function BrandingSection() {
  const { api, merchant, setMerchant } = useMerchant();
  const [name, setName] = useState(merchant.branding.name || merchant.name || "");
  const [accent, setAccent] = useState(merchant.branding.accent ?? "");
  const [supportUrl, setSupportUrl] = useState(merchant.branding.supportUrl ?? merchant.supportUrl ?? "");
  const [logoUrl, setLogoUrl] = useState<string | undefined>(merchant.branding.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The checkout renders in the subscriber's theme, so the accent must read
  // on both grounds; the weaker of the two decides.
  const ratio = accent ? Math.min(contrastRatio(accent, PAPER.dark) ?? 0, contrastRatio(accent, PAPER.light) ?? 0) : null;
  const lowContrast = accent.length > 0 && (ratio === null || ratio < 3);

  const onLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!["image/png", "image/svg+xml"].includes(file.type)) return setLogoError("Use a PNG or SVG.");
    if (file.size > MAX_LOGO_BYTES) return setLogoError("Keep the logo under 200 KB.");
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      setMerchant(
        await api.updateMerchant(
          { branding: { name: name.trim() || merchant.name || "", accent: accent.trim() || undefined, supportUrl: supportUrl.trim() || undefined, logoUrl } },
          { idempotencyKey: newIdempotencyKey() },
        ),
      );
      toast.success("Branding saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const preview = { name: name || "Your business", logoUrl, accent: lowContrast ? undefined : accent || undefined, supportUrl: supportUrl || undefined };

  return (
    <Section title="Checkout branding" lede="Your name, logo and accent on the hosted checkout. Layout and copy are always ours.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Display name</Label>
            <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-logo">Logo</Label>
            <input id="brand-logo" type="file" accept="image/png,image/svg+xml" onChange={(e) => onLogo(e.target.files?.[0])} className="text-[13px] text-ink-soft file:mr-3 file:h-9 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-[13px] file:font-medium file:text-foreground" />
            <p className="text-[12px] text-ink-soft">PNG or SVG, up to 200 KB. Shown at 24 px beside your name.</p>
            {logoError && (
              <p role="alert" className="text-[13px] text-caution">
                {logoError}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-accent">Accent colour</Label>
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-8 shrink-0 rounded-lg border border-border" style={{ background: accent && !lowContrast ? accent : "var(--live)" }} />
              <Input id="brand-accent" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#f5b74a" spellCheck={false} className="numerals h-10 max-w-[10rem] text-[13px]" />
            </div>
            <p className="text-[12px] text-ink-soft">{lowContrast ? <span className="text-caution">Hard to see against a light or dark page. Pick something with more contrast; the default amber is used until then.</span> : "Used for the live amount and the start button, in light and dark. Leave empty for the default amber."}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-support">Support URL</Label>
            <Input id="brand-support" type="url" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} className="numerals h-10 text-[14px]" />
          </div>
          <div>
            <Button type="submit" disabled={busy} className="h-9">
              {busy ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </form>
        <div className="lg:w-[390px]">
          <p className="placard">Preview · 390 px</p>
          <div data-testid="checkout-preview" className="mt-2 overflow-hidden rounded-lg border border-border">
            <div className="pointer-events-none origin-top-left [zoom:0.85] lg:[zoom:1]">
              <CheckoutFrame merchant={preview} className="min-h-[520px]">
                <RatePanel product={{ id: "prod_preview", name: "GPU · 4090", rateUsdPerSecond: "0.004", allowPause: false, status: "active" }} />
                <div className="mt-auto pt-6">
                  <Button size="lg" className="h-12 w-full text-base" tabIndex={-1}>
                    Continue
                  </Button>
                </div>
              </CheckoutFrame>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
