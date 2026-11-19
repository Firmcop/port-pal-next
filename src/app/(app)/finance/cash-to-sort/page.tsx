"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/finance/CashToSort"), {
  ssr: false,
  loading: () => <PageLoader />,
});

export default function Page() {
  return <RequireModule code="accounting"><Screen /></RequireModule>;
}
