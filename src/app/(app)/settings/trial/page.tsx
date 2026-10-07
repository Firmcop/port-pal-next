"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/TrialSettings"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /settings/trial
export default function Page() {
  return <RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole>;
}
