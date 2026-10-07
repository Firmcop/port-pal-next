"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/repatriation/Profitability"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /repatriation/profitability
export default function Page() {
  return <RequireModule code="inventory"><Screen /></RequireModule>;
}
