/**
 * The account API the browser uses. One instance per seed so state
 * persists across renders within a tab. Swap `createMockAccountApi` for
 * the real client when `api/` exists (FR-CHK-025).
 */
"use client";

import { ACCOUNT_SEEDS, createMockAccountApi, type AccountApi, type AccountSeed } from "./mock-api";

const instances = new Map<AccountSeed, AccountApi>();

/** Reads the `?as=` seed; anything unknown falls back to the default. */
export function parseSeed(value: string | null): AccountSeed {
  return (ACCOUNT_SEEDS as readonly string[]).includes(value ?? "")
    ? (value as AccountSeed)
    : "two-merchants";
}

export function getAccountApi(seed: AccountSeed): AccountApi {
  let instance = instances.get(seed);
  if (!instance) {
    instance = createMockAccountApi({ seed });
    instances.set(seed, instance);
  }
  return instance;
}
