"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/EIRRecords"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /gate/eir
export default function Page() {
  return <RequireModule code="gate"><Screen /></RequireModule>;
}
