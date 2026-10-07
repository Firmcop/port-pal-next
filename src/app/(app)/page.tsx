"use client";

import dynamic from "next/dynamic";
import { PageLoader } from "@/components/PageLoader";

const Screen = dynamic(() => import("@/views/Index"), {
  ssr: false,
  loading: () => <PageLoader />,
});

// Route migrated from react-router: 
export default function Page() {
  return <Screen />;
}
