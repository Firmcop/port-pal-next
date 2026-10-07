"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/assets/AssetMaintenance"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /assets/maintenance
export default function Page() {
  return <RequireModule code="assets"><Screen /></RequireModule>;
}
