"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequirePermission } from "@/components/RequirePermission";

const Screen = dynamic(() => import("@/views/hrm/PayrollReconciliation"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /hrm/payroll-reconciliation
export default function Page() {
  return <RequireModule code="hrm"><RequirePermission module="hrm" action="approve"><Screen /></RequirePermission></RequireModule>;
}
