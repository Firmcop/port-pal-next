"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/procurement/RFQDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /procurement/rfqs/:id
export default function Page() {
  return <RequireModule code="procurement"><Screen /></RequireModule>;
}
