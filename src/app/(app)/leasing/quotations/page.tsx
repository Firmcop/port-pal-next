"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/leasing/LeaseQuotations"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leasing/quotations
export default function Page() {
  return <RequireModule code="leasing"><Screen /></RequireModule>;
}
