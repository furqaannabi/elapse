/**
 * `/login/verify?token=&next=` — consumes the magic link. FR-DSH-011.
 */
import type { Metadata } from "next";
import { LoginFrame } from "@/components/login/login-frame";
import { VerifyLink } from "@/components/login/verify-link";

export const metadata: Metadata = { title: "Signing in" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;
  return (
    <LoginFrame>
      <VerifyLink token={token ?? null} next={next ?? null} />
    </LoginFrame>
  );
}
