"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireExpenseAccess } from "@/components/RequireExpenseAccess";

const Screen = dynamic(() => import("@/views/finance/OperatingExpenses"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/operating-expenses
export default function Page() {
  return <RequireExpenseAccess><Screen /></RequireExpenseAccess>;
}
