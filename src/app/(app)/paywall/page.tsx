"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Paywall"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: /paywall
export default function Page() {
  return <Screen />;
}
