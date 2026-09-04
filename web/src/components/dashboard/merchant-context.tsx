/**
 * Merchant session context: the signed-in merchant, the API handle, and a
 * refresh. Provided by `DashboardGate`; read with `useMerchant()` anywhere
 * under `/dashboard`.
 *
 * Maps to: FR-DSH-012.
 */
"use client";

import { createContext, useContext } from "react";
import type { DashboardApi } from "@/lib/dashboard/mock-api";
import type { Merchant } from "@/lib/dashboard/types";

export type MerchantSession = {
  merchant: Merchant;
  api: DashboardApi;
  /** Replace the cached merchant after a settings change. */
  setMerchant: (m: Merchant) => void;
};

const Ctx = createContext<MerchantSession | null>(null);

export const MerchantProvider = Ctx.Provider;

/** Same as `useMerchant` but null outside the gate (shell primitives, tests). */
export function useMerchantOptional(): MerchantSession | null {
  return useContext(Ctx);
}

export function useMerchant(): MerchantSession {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMerchant must be used under DashboardGate");
  return v;
}
