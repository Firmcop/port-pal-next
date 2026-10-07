"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";
import { RequireModule } from "@/components/RequireModule";

const Screen = dynamic(() => import("@/views/TrucksDrivers"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /gate/trucks-drivers
export default function Page() {
  return <RequireModule code="gate"><Screen /></RequireModule>;
}
