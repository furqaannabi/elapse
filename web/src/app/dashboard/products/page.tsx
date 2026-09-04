/**
 * `/dashboard/products` — FR-DSH-030…033.
 */
import { Suspense } from "react";
import { ProductsPage } from "@/components/dashboard/products-page";

export default function DashboardProducts() {
  return (
    <Suspense>
      <ProductsPage />
    </Suspense>
  );
}
