/**
 * `/dashboard/*` layout — every dashboard route renders inside the session
 * gate and the shell. FR-DSH-001, FR-DSH-012.
 */
import type { Metadata } from "next";
import { DashboardGate } from "@/components/dashboard/dashboard-gate";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardGate>{children}</DashboardGate>;
}
