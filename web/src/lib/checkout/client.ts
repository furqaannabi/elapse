/**
 * The checkout API the browser uses. One module-level instance so state
 * persists across renders and route transitions within a tab. Swap
 * `createMockCheckoutApi` for the real client when `api/` exists.
 */
"use client";

import { createMockCheckoutApi, type CheckoutApi } from "./mock-api";

let instance: CheckoutApi | null = null;

export function getCheckoutApi(): CheckoutApi {
  if (!instance) instance = createMockCheckoutApi();
  return instance;
}
