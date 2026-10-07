"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/vendor/VendorLifecycleEvents"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /vendor/events
export default function Page() {
  return <Screen />;
}
