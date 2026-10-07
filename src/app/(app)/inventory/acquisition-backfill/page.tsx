"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/AcquisitionBackfill"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /inventory/acquisition-backfill
export default function Page() {
  return <RequireModule code="inventory"><RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole></RequireModule>;
}
