"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Materials"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /materials
export default function Page() {
  return <RequireModule code="procurement"><Screen /></RequireModule>;
}
