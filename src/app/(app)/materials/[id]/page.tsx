"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/inventory/MaterialDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /materials/:id
export default function Page() {
  return <RequireModule code="procurement"><Screen /></RequireModule>;
}
