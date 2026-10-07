"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/assets/AssetsRegister"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /assets
export default function Page() {
  return <RequireModule code="assets"><Screen /></RequireModule>;
}
