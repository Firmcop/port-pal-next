"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/SalesOrders"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /sales-orders
export default function Page() {
  return <RequireModule code="crm"><Screen /></RequireModule>;
}
