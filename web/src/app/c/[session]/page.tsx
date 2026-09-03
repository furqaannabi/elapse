/**
 * Hosted checkout route: `/c/[session]`.
 *
 * Server component that reads the session id and hands off to the client
 * orchestrator. No merchant secret is ever available here; the page is
 * driven by the session id alone (BR-CHK-005).
 *
 * Maps to: FR-CHK-001; design brief Surface 2.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutPage } from "@/components/checkout/checkout-page";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ session: string }>;
}) {
  const { session } = await params;
  return (
    <Suspense fallback={null}>
      <CheckoutPage sessionId={session} />
    </Suspense>
  );
}
