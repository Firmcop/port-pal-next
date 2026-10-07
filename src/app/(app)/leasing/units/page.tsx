"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/leasing/LeaseUnits"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leasing/units
export default function Page() {
  return <RequireModule code="leasing"><Screen /></RequireModule>;
}
