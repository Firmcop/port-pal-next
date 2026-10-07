"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/vendor/VendorOrganizations"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /vendor/organizations
export default function Page() {
  return <Screen />;
}
