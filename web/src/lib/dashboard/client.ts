/**
 * The dashboard API the browser uses. One module-level instance so state persists across
 * renders and route transitions within a tab. With `NEXT_PUBLIC_ELAPSE_API_URL` set the real
 * `/v1` client is used (cookie session, FR-DSH-110); without it, or with
 * `NEXT_PUBLIC_DASHBOARD_MOCK=1`, the in-memory mock with its seeded merchant.
 */
"use client";

import { createMockDashboardApi, type DashboardApi } from "./mock-api";
import { createRealDashboardApi } from "./real-api";
import { getMode } from "./mode";

const API_URL = process.env.NEXT_PUBLIC_ELAPSE_API_URL;
const FORCE_MOCK = process.env.NEXT_PUBLIC_DASHBOARD_MOCK === "1";

let instance: DashboardApi | null = null;

export function usesRealDashboardApi(): boolean {
  return Boolean(API_URL) && !FORCE_MOCK;
}

export function getDashboardApi(): DashboardApi {
  if (!instance) instance = usesRealDashboardApi() ? createRealDashboardApi({ baseUrl: API_URL!, getMode }) : createMockDashboardApi();
  return instance;
}
