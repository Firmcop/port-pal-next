"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/portal/PortalReleases"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /portal/releases
export default function Page() {
  return <Screen />;
}
