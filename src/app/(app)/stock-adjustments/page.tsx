"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/inventory/StockAdjustments"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /stock-adjustments
export default function Page() {
  return <Screen />;
}
