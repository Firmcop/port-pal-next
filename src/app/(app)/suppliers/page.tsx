"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/Suppliers"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /suppliers
export default function Page() {
  return <RequireModule code="procurement"><Screen /></RequireModule>;
}
