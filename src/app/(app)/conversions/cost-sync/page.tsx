"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/conversions/ConversionCostSync"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /conversions/cost-sync
export default function Page() {
  return <RequireModule code="manufacturing"><RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole></RequireModule>;
}
