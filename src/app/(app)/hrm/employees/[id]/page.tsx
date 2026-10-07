"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequirePermission } from "@/components/RequirePermission";

const Screen = dynamic(() => import("@/views/hrm/EmployeeDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /hrm/employees/:id
export default function Page() {
  return <RequireModule code="hrm"><RequirePermission module="hrm" action="view"><Screen /></RequirePermission></RequireModule>;
}
