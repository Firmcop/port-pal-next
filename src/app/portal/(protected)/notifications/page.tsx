"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/portal/PortalNotifications"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /portal/notifications
export default function Page() {
  return <Screen />;
}
