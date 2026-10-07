"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Reports"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /reports
export default function Page() {
  return <Screen />;
}
