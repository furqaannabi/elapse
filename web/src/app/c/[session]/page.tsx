/**
 * `/c/[session]` — retired (checkout FR-CHK-040, ADR 2026-09-17 delete the hosted checkout now).
 * Subscribers authorise and watch their meter inside the merchant's app with `@elapse/react`; an old
 * link says so and points back to the merchant.
 */
import type { Metadata } from "next";
import { RetiredCheckout } from "@/components/checkout/retired-checkout";

export const metadata: Metadata = {
  title: "Checkout link no longer used",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  return <RetiredCheckout sessionId={session} />;
}
