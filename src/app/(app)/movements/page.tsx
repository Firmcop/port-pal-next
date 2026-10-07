"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Movements"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /movements
export default function Page() {
  return <RequireModule code="inventory"><Screen /></RequireModule>;
}
