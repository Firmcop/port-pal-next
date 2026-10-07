"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/finance/AccountingPolicies"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/accounting-policies
export default function Page() {
  return <RequireRole roles={["org_owner","admin","accountant"]}><Screen /></RequireRole>;
}
