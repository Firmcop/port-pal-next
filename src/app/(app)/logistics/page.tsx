"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/logistics/LogisticsDashboard"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /logistics
export default function Page() {
  return <RequireModule code="logistics"><Screen /></RequireModule>;
}
