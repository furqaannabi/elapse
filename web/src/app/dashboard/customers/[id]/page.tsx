import { CustomerDetail } from "@/components/dashboard/customer-detail";

export default async function DashboardCustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail customerId={id} />;
}
