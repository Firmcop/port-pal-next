"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/leasing/LeaseBillingRun"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leasing/billing
export default function Page() {
  return <RequireModule code="leasing"><Screen /></RequireModule>;
}
