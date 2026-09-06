/**
 * `PrivyCheckout` — wraps the hosted page in Privy with Monad configured, and supplies the
 * real `AuthFlow`. Privy attaches passkeys to accounts rather than creating accounts from them,
 * so a first visit signs in by email code and then offers to attach Face ID; a device that has
 * done that leads with Face ID (decided 2026-09-06, William, option a). After either, the
 * embedded wallet is created explicitly when the user has none, because automatic creation
 * only fires for Privy's own modal and this page uses its own screens. The wallet is handed to
 * the API client through `setSubscriberWallet`; the page never sees it.
 *
 * Maps to: FR-CHK-002, FR-CHK-016; ADR 2026-09-04 (subscriber signs the permit).
 */
"use client";

import {
  PrivyProvider,
  useCreateWallet,
  useLinkWithPasskey,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithPasskey,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthFlowProvider, type AuthFlow, type AuthResult } from "../auth-flow";
import { setSubscriberWallet } from "../client";
import { monad, monadTestnet } from "./chains";
import { subscriberWalletFrom } from "./wallet-adapter";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);
/** Remembered per device once a passkey is attached, so the next visit leads with Face ID. */
const FACE_ID_KEY = "elapse.faceid";
const readFaceIdFlag = () => {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(FACE_ID_KEY) === "1";
  } catch {
    return false;
  }
};
/** Privy appends `privy_oauth_*` to the current URL on return; a second attempt from that URL doubles them and fails the state check. */
const stripOAuthParams = () => {
  try {
    const u = new URL(window.location.href);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("privy_oauth_")) {
        u.searchParams.delete(k);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", u.toString());
  } catch {
    /* not in a browser */
  }
};
const writeFaceIdFlag = () => {
  try {
    localStorage.setItem(FACE_ID_KEY, "1");
  } catch {
    /* private mode: the next visit simply starts with email again */
  }
};

export function PrivyCheckout({ children }: { children: ReactNode }) {
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["passkey", "email"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        supportedChains: [monadTestnet, monad],
        defaultChain: CHAIN_ID === 143 ? monad : monadTestnet,
        appearance: { walletChainType: "ethereum-only" },
      }}
    >
      <PrivyAuthFlow>{children}</PrivyAuthFlow>
    </PrivyProvider>
  );
}

/** Resolves once per login: a promise the sheet awaits, settled by Privy's callbacks. */
type Pending = { resolve: (r: AuthResult) => void; reject: (e: Error) => void; email?: string };

function PrivyAuthFlow({ children }: { children: ReactNode }) {
  const { user, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const pending = useRef<Pending | null>(null);
  const [passkeyFirst, setPasskeyFirst] = useState(false);
  const [resumed, setResumed] = useState<AuthResult | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  useEffect(() => {
    setPasskeyFirst(readFaceIdFlag());
  }, []);

  const fail = useCallback((e: unknown) => {
    pending.current?.reject(e instanceof Error ? e : new Error("Sign-in did not complete"));
    pending.current = null;
  }, []);

  // `wallets` in a callback closure goes stale the moment createWallet resolves; read the latest.
  const walletsRef = useRef(wallets);
  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);
  const embedded = () => walletsRef.current.find((x) => x.walletClientType === "privy") ?? null;

  /** Find or create the embedded wallet, hand it to the client, settle the pending sign-in. */
  const finish = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    try {
      let w = embedded();
      if (!w) {
        await createWallet();
        for (let i = 0; i < 40 && !w; i++) {
          await new Promise((r) => setTimeout(r, 250));
          w = embedded();
        }
      }
      if (!w) throw new Error("Could not set up your account. Please try again.");
      setSubscriberWallet(subscriberWalletFrom(w, CHAIN_ID));
      const email = p.email ?? user?.email?.address;
      pending.current = null;
      p.resolve(email ? { email } : {});
    } catch (e) {
      fail(e);
    }
  }, [createWallet, user, fail]);

  const { loginWithPasskey } = useLoginWithPasskey({
    onComplete: () => {
      writeFaceIdFlag();
      setPasskeyFirst(true);
      void finish();
    },
    onError: (e) => fail(e),
  });
  const link = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const { linkWithPasskey } = useLinkWithPasskey({
    onSuccess: () => {
      writeFaceIdFlag();
      setPasskeyFirst(true);
      link.current?.resolve();
      link.current = null;
    },
    onError: (e) => {
      link.current?.reject(new Error(typeof e === "string" ? e : "Face ID could not be set up"));
      link.current = null;
    },
  });
  // Google returns to this URL with the sheet gone; the hook completes the login on load and we
  // finish the wallet, then tell the page to resume on the Face ID offer.
  const { initOAuth } = useLoginWithOAuth({
    onComplete: ({ user: u, wasAlreadyAuthenticated }) => {
      stripOAuthParams();
      if (wasAlreadyAuthenticated) return;
      const email = u.google?.email ?? u.email?.address;
      pending.current = { resolve: (r) => setResumed(r), reject: () => setResumed({}), ...(email ? { email } : {}) };
      void finish();
    },
    onError: () => stripOAuthParams(),
  });
  const { sendCode, loginWithCode } = useLoginWithEmail({ onComplete: () => void finish(), onError: (e) => fail(e) });

  // A returning subscriber is already authenticated on load (Privy keeps its session): hand the
  // wallet over and let the page sign in silently. Also the safety net for the Google return.
  useEffect(() => {
    if (!ready || !authenticated) {
      setWalletReady(false);
      return;
    }
    const w = wallets.find((x) => x.walletClientType === "privy");
    if (w) {
      setSubscriberWallet(subscriberWalletFrom(w, CHAIN_ID));
      setWalletReady(true);
    }
  }, [ready, authenticated, wallets]);

  const flow = useMemo<AuthFlow>(
    () => ({
      usesCode: true,
      passkeyFirst: passkeyFirst || authenticated,
      canLinkPasskey: true,
      google: () => {
        stripOAuthParams();
        return initOAuth({ provider: "google" });
      },
      resumed,
      signedInAlready: walletReady,
      linkPasskey: () =>
        new Promise<void>((resolve, reject) => {
          link.current = { resolve, reject };
          void linkWithPasskey();
        }),
      passkey: () =>
        new Promise<AuthResult>((resolve, reject) => {
          pending.current = { resolve, reject };
          if (authenticated) {
            void finish();
            return;
          }
          void loginWithPasskey();
        }),
      sendCode: async (email) => {
        await sendCode({ email });
      },
      verifyCode: (email, code) =>
        new Promise<AuthResult>((resolve, reject) => {
          pending.current = { resolve, reject, email };
          void loginWithCode({ code });
        }),
    }),
    [authenticated, passkeyFirst, resumed, walletReady, finish, loginWithPasskey, linkWithPasskey, initOAuth, sendCode, loginWithCode],
  );

  return <AuthFlowProvider value={flow}>{children}</AuthFlowProvider>;
}
