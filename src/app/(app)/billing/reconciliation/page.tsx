"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/GateFeeReconciliation"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /billing/reconciliation
export default function Page() {
  return <RequireModule code="billing"><Screen /></RequireModule>;
}
