"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/finance/YearEndClose"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/year-end-close
export default function Page() {
  return <RequireModule code="accounting"><RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole></RequireModule>;
}
