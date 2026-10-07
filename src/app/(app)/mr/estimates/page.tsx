"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/DamageEstimates"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /mr/estimates
export default function Page() {
  return <RequireModule code="mr"><Screen /></RequireModule>;
}
