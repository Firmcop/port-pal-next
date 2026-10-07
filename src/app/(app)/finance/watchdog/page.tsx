"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/finance/FinanceWatchdog"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /finance/watchdog
export default function Page() {
  return <RequireModule code="accounting"><Screen /></RequireModule>;
}
