"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/inventory/StockReconciliation"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /stock-reconciliation
export default function Page() {
  return <Screen />;
}
