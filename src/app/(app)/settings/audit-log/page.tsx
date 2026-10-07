"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/AuditLog"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /settings/audit-log
export default function Page() {
  return <RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole>;
}
