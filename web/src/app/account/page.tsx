/**
 * Subscriber account route: `/account`.
 *
 * Server component that hands off to the client page. Elapse-branded and
 * cross-merchant by decision (ADR 2026-09-04); optional for merchants,
 * who can build the same actions into their own product with the SDK.
 *
 * Maps to: FR-CHK-016–026; design brief Surface 4.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountRoute } from "@/components/account/account-route";

export const metadata: Metadata = {
  title: "Your meters",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountRoute />
    </Suspense>
  );
}
