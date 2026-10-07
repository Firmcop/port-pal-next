"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/ConversionDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /conversions/:id
export default function Page() {
  return <RequireModule code="manufacturing"><Screen /></RequireModule>;
}
