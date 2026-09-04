/**
 * `/login` — merchant sign-in by email magic link. FR-DSH-010.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login/login-form";
import { LoginFrame } from "@/components/login/login-frame";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <LoginFrame>
      <Suspense>
        <LoginForm />
      </Suspense>
    </LoginFrame>
  );
}
