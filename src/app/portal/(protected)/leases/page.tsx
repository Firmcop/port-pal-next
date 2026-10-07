"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/portal/PortalLeases"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /portal/leases
export default function Page() {
  return <Screen />;
}
