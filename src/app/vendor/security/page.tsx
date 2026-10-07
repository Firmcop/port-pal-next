"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/vendor/VendorSecurityFindings"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /vendor/security
export default function Page() {
  return <Screen />;
}
