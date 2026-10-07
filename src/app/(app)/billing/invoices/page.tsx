"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Invoices"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /billing/invoices
export default function Page() {
  return <RequireModule code="billing"><Screen /></RequireModule>;
}
