"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/assets/AssetDisposals"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /assets/disposals
export default function Page() {
  return <RequireModule code="assets"><Screen /></RequireModule>;
}
