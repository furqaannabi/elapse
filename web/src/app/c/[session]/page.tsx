/**
 * Hosted checkout route: `/c/[session]`.
 *
 * Server component that reads the session id and hands off to the client
 * root. No merchant secret is ever available here; the page is driven by
 * the session id alone (BR-CHK-005; decided 2026-09-05, the id is the pass).
 *
 * Maps to: FR-CHK-001; design brief Surface 2.
 */
import type { Metadata } from "next";
import { CheckoutRoot } from "@/components/checkout/checkout-root";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  return <CheckoutRoot sessionId={session} />;
}
