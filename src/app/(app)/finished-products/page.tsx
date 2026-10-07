"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/FinishedProducts"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finished-products
export default function Page() {
  return <RequireModule code="manufacturing"><Screen /></RequireModule>;
}
