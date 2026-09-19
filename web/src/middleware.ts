/**
 * FR-CHK-038 (amended 2026-09-19): who may put `/authorize` in a frame.
 *
 * `@elapse/react` renders this page inside a modal on the merchant's own page, so the page must be
 * framable — but only by that merchant. A page anyone can frame can be framed under an invisible
 * overlay and a subscriber tricked into authorising a session they never meant to. The allowed
 * origin is the session's own `success_url`, which the merchant set on its server; the publishable
 * key in the URL is what lets this read it, and it is public by design.
 *
 * Anything unexpected — no key, no session, an API that does not answer — falls back to `'none'`:
 * the window path still works, and no one gets to frame the page on a guess.
 */
import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: "/authorize" };

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.elapse.finance";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
    return null;
  } catch {
    return null;
  }
}

async function merchantOrigin(session: string, pk: string): Promise<string | null> {
  if (!/^cs_[A-Za-z0-9]+$/.test(session) || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(pk)) return null;
  try {
    const res = await fetch(`${API}/v1/checkout/sessions/${session}`, {
      headers: { authorization: `Bearer ${pk}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { merchant?: { success_url?: string } };
    return originOf(body.merchant?.success_url);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const q = request.nextUrl.searchParams;
  const ancestor = q.get("mode") === "frame" ? await merchantOrigin(q.get("session") ?? "", q.get("pk") ?? "") : null;
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestor ?? "'none'"}`);
  return response;
}
