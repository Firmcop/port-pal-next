"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/AccountingTransactions"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /accounting/transactions
export default function Page() {
  return <RequireModule code="accounting"><RequireRole roles={["org_owner","admin","viewer"]}><Screen /></RequireRole></RequireModule>;
}
