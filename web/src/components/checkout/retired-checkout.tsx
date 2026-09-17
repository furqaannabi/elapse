/**
 * `RetiredCheckout` — what `/c/[session]` shows now that the hosted checkout is gone (FR-CHK-040,
 * ADR 2026-09-17 delete now). Merchants authorise and meter inside their own app with
 * `@elapse/react`; an old link gets one sentence and, when the session is known, a way back.
 */
"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getCheckoutApi } from "@/lib/checkout/client";
import { cn } from "@/lib/utils";
import { CheckoutFrame } from "./checkout-frame";

export function RetiredCheckout({ sessionId }: { sessionId: string }) {
  const [merchant, setMerchant] = useState<{ name: string; cancelUrl: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getCheckoutApi(sessionId)
      .getSession(sessionId)
      .then((s) => alive && setMerchant({ name: s.merchant.name, cancelUrl: s.merchant.cancelUrl }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId]);

  return (
    <CheckoutFrame merchant={{ name: merchant?.name ?? "Elapse" }}>
      <section className="flex flex-1 flex-col justify-center gap-6 py-10">
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.02em]">This checkout link is no longer used.</h1>
        {merchant && (
          <a href={merchant.cancelUrl} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-12 w-full text-base")}>
            Return to {merchant.name}
          </a>
        )}
      </section>
    </CheckoutFrame>
  );
}
