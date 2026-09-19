/**
 * The Elapse signing popup: `/authorize?session=cs_…&action=authorise|cancel|pause|resume&cap=…&nonce=…`.
 *
 * Rendered by `@elapse/react` for every signature — in its modal frame, or in a window when the
 * frame cannot do Face ID — so the subscriber's wallet only ever runs on Elapse's origin
 * (ADR 2026-09-17 React SDK, ADR 2026-09-19 modal frame; checkout FR-CHK-038/039).
 */
import type { Metadata } from "next";
import { AuthorizeRoot } from "@/components/authorize/authorize-root";

export const metadata: Metadata = {
  title: "Authorise with Elapse",
  robots: { index: false, follow: false },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const cap = one(q.cap);
  // `mode=frame` means `@elapse/react` is rendering this page in its modal (FR-RCT-043); the page
  // then reports whether Face ID can work there. `pk` is read by the middleware, not here.
  const mode = one(q.mode);
  return <AuthorizeRoot session={one(q.session)} action={one(q.action)} nonce={one(q.nonce)} {...(cap ? { cap } : {})} {...(mode ? { mode } : {})} />;
}
