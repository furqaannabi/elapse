/**
 * `ElapseProvider` — the one place a merchant configures `@elapse/react`: the publishable key, the
 * Elapse host, the theme and whether sound plays. Every component and hook reads it from context.
 *
 * It refuses a secret key outright (BR-RCT-002): a key that can create sessions or cancel meters
 * must never reach a browser, and failing at render makes the mistake impossible to ship unnoticed.
 *
 * Maps to: FR-RCT-003; BR-RCT-002.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PopupHost } from "./popup";

export interface ElapseConfig {
  publishableKey: string;
  /** The Elapse API; defaults to production. */
  baseUrl: string;
  /** Where the signing popup lives (FR-CHK-038); defaults to production. */
  appOrigin: string;
  sound: boolean;
  /** Testing seams; merchants never set these. */
  fetch: typeof fetch;
  popupHost: PopupHost | undefined;
}

const ElapseContext = createContext<ElapseConfig | null>(null);

export function ElapseProvider({
  publishableKey,
  baseUrl = "https://api.elapse.finance",
  appOrigin = "https://elapse.finance",
  sound = true,
  fetch: fetchFn,
  popupHost,
  children,
}: {
  publishableKey: string;
  baseUrl?: string;
  appOrigin?: string;
  sound?: boolean;
  /** @internal Testing seam: the fetch used for API reads. */
  fetch?: typeof fetch;
  /** @internal Testing seam: the window the popup is opened from. */
  popupHost?: PopupHost;
  children: ReactNode;
}) {
  if (publishableKey.startsWith("sk_")) {
    throw new Error("Never put a secret key in the browser. Pass your publishable key (pk_…) to ElapseProvider.");
  }
  if (!publishableKey.startsWith("pk_")) {
    throw new Error("ElapseProvider needs a publishable key (pk_test_… or pk_live_…).");
  }
  const value = useMemo(
    () => ({
      publishableKey,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      appOrigin: appOrigin.replace(/\/+$/, ""),
      sound,
      fetch: fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
      popupHost,
    }),
    [publishableKey, baseUrl, appOrigin, sound, fetchFn, popupHost],
  );
  return <ElapseContext.Provider value={value}>{children}</ElapseContext.Provider>;
}

/** The provider's configuration; throws when a component is used outside `ElapseProvider`. */
export function useElapseConfig(): ElapseConfig {
  const config = useContext(ElapseContext);
  if (!config) throw new Error("Elapse components must be inside <ElapseProvider>.");
  return config;
}
