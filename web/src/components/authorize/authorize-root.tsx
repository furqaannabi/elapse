/**
 * `AuthorizeRoot` — client entry for `/authorize`: demo session ids stay on the in-memory mock with
 * no Privy; every other id gets the same wallet layer as the hosted checkout (FR-CHK-038).
 */
"use client";

import { usesRealApi } from "@/lib/checkout/client";
import { PrivyCheckout } from "@/lib/checkout/privy/privy-checkout";
import { AuthorizePage } from "./authorize-page";

export function AuthorizeRoot(props: { session: string; action: string; cap?: string; nonce: string }) {
  const page = <AuthorizePage {...props} />;
  return usesRealApi(props.session) ? <PrivyCheckout>{page}</PrivyCheckout> : page;
}
