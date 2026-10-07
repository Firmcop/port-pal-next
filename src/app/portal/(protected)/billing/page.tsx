"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/portal/PortalBilling"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /portal/billing
export default function Page() {
  return <Screen />;
}
