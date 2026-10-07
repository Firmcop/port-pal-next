"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Leads"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leads
export default function Page() {
  return <RequireModule code="crm"><Screen /></RequireModule>;
}
