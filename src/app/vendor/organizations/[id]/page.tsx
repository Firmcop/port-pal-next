"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/vendor/VendorOrganizationDetail"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /vendor/organizations/:id
export default function Page() {
  return <Screen />;
}
