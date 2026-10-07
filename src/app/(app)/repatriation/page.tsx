"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Repatriation"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /repatriation
export default function Page() {
  return <RequireModule code="inventory"><Screen /></RequireModule>;
}
