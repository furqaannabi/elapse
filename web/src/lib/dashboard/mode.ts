/**
 * Test / live mode store for the merchant dashboard.
 *
 * Test mode is the default. The choice is remembered per browser under
 * `elapse-mode` and read through `useSyncExternalStore` so server and client
 * agree (the server snapshot is always "test"). Every dashboard request
 * carries the current mode; the API scopes all data by it.
 *
 * Maps to: FR-DSH-003, FR-DSH-004; BR-DSH-002.
 */
"use client";

import { useSyncExternalStore } from "react";

export type Mode = "test" | "live";

export const MODE_STORAGE_KEY = "elapse-mode";

const listeners = new Set<() => void>();

function isMode(value: unknown): value is Mode {
  return value === "test" || value === "live";
}

/** The current mode, "test" when nothing valid is stored. */
export function getMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return isMode(stored) ? stored : "test";
  } catch {
    return "test";
  }
}

/** Switches mode immediately and remembers it for this browser. */
export function setMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {}
  for (const l of listeners) l();
}

export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = (): Mode => "test";

/** React binding. Re-renders on every mode change. */
export function useMode(): Mode {
  return useSyncExternalStore(subscribeMode, getMode, getServerSnapshot);
}
