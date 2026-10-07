"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Quotes"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /quotes
export default function Page() {
  return <RequireModule code="crm"><Screen /></RequireModule>;
}
