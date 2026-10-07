"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/leasing/LeaseAgreementDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /leasing/agreements/:id
export default function Page() {
  return <RequireModule code="leasing"><Screen /></RequireModule>;
}
