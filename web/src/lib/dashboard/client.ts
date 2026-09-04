/**
 * The dashboard API the browser uses. One module-level instance so state
 * persists across renders and route transitions within a tab. Swap
 * `createMockDashboardApi` for the real `/v1/dashboard/*` client when
 * `api/` exists (FR-DSH-110).
 */
"use client";

import { createMockDashboardApi, type DashboardApi } from "./mock-api";

let instance: DashboardApi | null = null;

export function getDashboardApi(): DashboardApi {
  if (!instance) instance = createMockDashboardApi();
  return instance;
}
