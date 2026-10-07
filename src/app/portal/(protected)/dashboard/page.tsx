"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/portal/PortalDashboard"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /portal/dashboard
export default function Page() {
  return <Screen />;
}
