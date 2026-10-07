"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/finance/ProjectDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/projects/:id
export default function Page() {
  return <RequireModule code={["accounting","manufacturing"]}><RequireRole roles={["org_owner","admin","viewer","accountant","sales_manager","production_manager","procurement_officer","supply_chain_manager"]}><Screen /></RequireRole></RequireModule>;
}
