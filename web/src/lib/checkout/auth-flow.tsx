/**
 * `AuthFlow` — what the sign-in sheet needs from an identity provider, and nothing more:
 * a passkey step and an email code step, each resolving to the signed-in subscriber.
 * The default is the mock (FR-CHK-002, FR-CHK-015: seeded sessions work with no Privy);
 * `PrivyCheckout` provides the real one. The sheet renders the same screen either way.
 *
 * Maps to: FR-CHK-002, FR-CHK-016; BR-CHK-001 (the flow never surfaces wallet words).
 */
"use client";

import { createContext, useContext } from "react";

export type AuthResult = { email?: string };

export interface AuthFlow {
  /**
   * Lead with Face ID: the subscriber has signed in here before (decided 2026-09-06, option a:
   * a passkey attaches to an account, so a first visit starts with email).
   */
  passkeyFirst: boolean;
  /** Whether the provider can attach Face ID to the account after an email sign-in. */
  canLinkPasskey: boolean;
  /** Attach a passkey to the signed-in account (the "Use Face ID next time" offer). */
  linkPasskey(): Promise<void>;
  /** Face ID / passkey. Resolves when the device has confirmed the person. */
  passkey(): Promise<AuthResult>;
  /** Email fallback: send a one-time code, then verify it. */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthResult>;
  /** Whether verifyCode is required after sendCode (the mock has no code). */
  usesCode: boolean;
  /** Google sign-in (decided 2026-09-06): redirects away and back to this URL. Absent = not offered. */
  google?: () => Promise<void>;
  /**
   * Set once after a redirect sign-in (Google) has completed on this page load: the sheet was
   * closed by the redirect, so the page picks the sign-in up from here and shows the Face ID offer.
   */
  resumed?: AuthResult | null;
  /**
   * The provider already holds a signed-in session on this device (Privy keeps one across
   * reloads). The page signs in silently instead of asking again.
   */
  signedInAlready?: boolean;
}

export const mockAuthFlow: AuthFlow = {
  passkeyFirst: true,
  canLinkPasskey: false,
  linkPasskey: async () => {},
  usesCode: false,
  passkey: () => new Promise((r) => setTimeout(() => r({}), 1100)),
  sendCode: async () => {},
  verifyCode: async (email) => ({ email }),
};

const AuthFlowContext = createContext<AuthFlow>(mockAuthFlow);
export const AuthFlowProvider = AuthFlowContext.Provider;
export const useAuthFlow = () => useContext(AuthFlowContext);
