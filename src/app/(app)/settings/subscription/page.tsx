"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireRole } from "@/components/RequireRole";

const Screen = dynamic(() => import("@/views/SubscriptionSettings"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /settings/subscription
export default function Page() {
  return <RequireRole roles={["org_owner","admin"]}><Screen /></RequireRole>;
}
