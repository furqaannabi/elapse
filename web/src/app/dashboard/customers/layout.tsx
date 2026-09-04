/** `/dashboard/customers` — split list + detail. FR-DSH-050/051. */
import { CustomersLayout } from "@/components/dashboard/customers-layout";

export default function DashboardCustomersLayout({ children }: { children: React.ReactNode }) {
  return <CustomersLayout>{children}</CustomersLayout>;
}
