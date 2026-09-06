/**
 * `CheckoutRoot` — client entry for `/c/[session]`: seeded demo ids stay on the in-memory
 * mock with no Privy (FR-CHK-015); every other id gets the wallet layer and the real API.
 */
"use client";

import { Suspense } from "react";
import { usesRealApi } from "@/lib/checkout/client";
import { PrivyCheckout } from "@/lib/checkout/privy/privy-checkout";
import { CheckoutPage } from "./checkout-page";

export function CheckoutRoot({ sessionId }: { sessionId: string }) {
  const page = (
    <Suspense fallback={null}>
      <CheckoutPage sessionId={sessionId} />
    </Suspense>
  );
  return usesRealApi(sessionId) ? <PrivyCheckout>{page}</PrivyCheckout> : page;
}
