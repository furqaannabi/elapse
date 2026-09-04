/** `CustomersLayout` — split structure for Customers. */
"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { CustomersList } from "./customers-list";
import { SplitLayout } from "./split-layout";

export function CustomersLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return <SplitLayout list={<CustomersList />} detail={children} hasDetail={segment !== null} backHref="/dashboard/customers" backLabel="Customers" />;
}
