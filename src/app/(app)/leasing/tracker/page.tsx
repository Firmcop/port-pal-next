"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/leasing/LeaseTracker"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leasing/tracker
export default function Page() {
  return <RequireModule code="leasing"><Screen /></RequireModule>;
}
