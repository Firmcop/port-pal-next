"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/vendor/VendorDbLoad"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /vendor/db-load
export default function Page() {
  return <Screen />;
}
